# People Manager v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the MiniMe secretary per-person behavior control (reply mode, relation, tone, standing instructions) and a working "add a person by forwarding" flow, editable from the People page.

**Architecture:** Extend the existing `notification_prefs.personal_contacts` JSON array (no DB migration). A new pure-logic module `peoplePolicy.js` holds the testable decisions (effective reply action + prompt directives). The webhook applies the per-person reply mode; the reply engine injects per-person directives into the secretary prompt and implements forward-to-add; the People page edits the new fields.

**Tech Stack:** Node 22 (built-in `node:test`), Next.js (App Router, React), Supabase JS, Telegram Bot API. The `apps/web` package is CommonJS — the pure module uses `module.exports` so both Next (import interop) and `node --test` load it with zero config.

**Spec:** `docs/superpowers/specs/2026-06-15-people-manager-v2-design.md`

---

## File Structure

- **Create:** `apps/web/src/lib/server/peoplePolicy.js` — pure functions + constants: `RELATIONS`, `REPLY_MODES`, `TONES`, `resolveContactAction()`, `isPersonalRelation()`, `buildContactDirectives()`. No Supabase/Telegram/Next imports, so it is unit-testable directly.
- **Create:** `apps/web/src/lib/server/peoplePolicy.test.js` — `node:test` unit tests for the module.
- **Modify:** `apps/web/src/app/api/agent-bot/webhook/route.js` — in the known-personal-contact branch, apply `resolveContactAction` (silent → forward only; ask → forward + "reply yourself"; reply → proceed).
- **Modify:** `apps/web/src/lib/server/replyEngine.js` — (a) carry `instructions`/`tone`/`relation` from the saved contact into `conversation.metadata.contact_profile`; (b) append `buildContactDirectives(...)` to the injected `contactProfileLine`; (c) implement forward-to-add in the `/personal` handler.
- **Modify:** `apps/web/src/app/(dashboard)/settings/people/page.js` — relation dropdown (6 values), reply-mode pills, tone quick-pick, instructions textarea; render all relations; persist new fields.

---

## Task 1: Pure policy module

**Files:**
- Create: `apps/web/src/lib/server/peoplePolicy.js`
- Test: `apps/web/src/lib/server/peoplePolicy.test.js`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/peoplePolicy.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RELATIONS, REPLY_MODES, TONES,
  resolveContactAction, isPersonalRelation, buildContactDirectives,
} = require('./peoplePolicy');

test('constants expose the expected enums', () => {
  assert.deepEqual(RELATIONS, ['family', 'friend', 'colleague', 'customer', 'vip', 'other']);
  assert.deepEqual(REPLY_MODES, ['default', 'auto', 'ask_first', 'silent']);
  assert.deepEqual(TONES, ['default', 'warm', 'formal', 'playful', 'brief']);
});

test('resolveContactAction: explicit per-person mode wins over global', () => {
  assert.equal(resolveContactAction('auto', 'ask_first'), 'reply');
  assert.equal(resolveContactAction('silent', 'auto'), 'silent');
  assert.equal(resolveContactAction('ask_first', 'auto'), 'ask');
});

test('resolveContactAction: default inherits the global mode', () => {
  assert.equal(resolveContactAction('default', 'auto'), 'reply');
  assert.equal(resolveContactAction('default', 'ask_first'), 'ask');
  assert.equal(resolveContactAction('default', 'ghost'), 'silent');
});

test('resolveContactAction: missing/unknown values are safe', () => {
  // No per-person mode + no global → safest default is "ask" (never auto-speak).
  assert.equal(resolveContactAction(undefined, undefined), 'ask');
  assert.equal(resolveContactAction('bogus', 'auto'), 'reply');
});

test('isPersonalRelation: everything except customer is personal', () => {
  assert.equal(isPersonalRelation('family'), true);
  assert.equal(isPersonalRelation('vip'), true);
  assert.equal(isPersonalRelation('customer'), false);
  assert.equal(isPersonalRelation(''), false);
  assert.equal(isPersonalRelation(undefined), false);
});

test('buildContactDirectives: empty when nothing to say', () => {
  assert.equal(buildContactDirectives({}), '');
  assert.equal(buildContactDirectives({ tone: 'default', instructions: '   ' }), '');
});

test('buildContactDirectives: includes instructions and tone', () => {
  const out = buildContactDirectives({ instructions: 'never discuss money', tone: 'formal' });
  assert.match(out, /standing orders/i);
  assert.match(out, /never discuss money/);
  assert.match(out, /polite and formal/i);
});

test('buildContactDirectives: caps instruction length', () => {
  const out = buildContactDirectives({ instructions: 'x'.repeat(900) });
  // 400 cap + label text, never the full 900.
  assert.ok(out.length < 600, `directive too long: ${out.length}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/web/src/lib/server/peoplePolicy.test.js`
Expected: FAIL — `Cannot find module './peoplePolicy'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/server/peoplePolicy.js`:

```js
/**
 * Pure, dependency-free policy helpers for per-person secretary behavior.
 *
 * Kept free of Supabase / Telegram / Next imports so it can be unit-tested with
 * `node --test` and reused by both the webhook and the reply engine.
 *
 * Per-person fields live on each entry of
 * `businesses.notification_prefs.personal_contacts`:
 *   { telegram_id, name, aliases[], context,
 *     relation, reply_mode, instructions, tone, added_at, source }
 */

const RELATIONS = ['family', 'friend', 'colleague', 'customer', 'vip', 'other'];
const REPLY_MODES = ['default', 'auto', 'ask_first', 'silent'];
const TONES = ['default', 'warm', 'formal', 'playful', 'brief'];

const TONE_PHRASE = {
  warm: 'warm and affectionate',
  formal: 'polite and formal',
  playful: 'playful and casual',
  brief: 'very brief — a line or two at most',
};

/**
 * What should the bot DO for a known contact?
 * @param {string} replyMode  per-person reply_mode ('default'|'auto'|'ask_first'|'silent')
 * @param {string} globalMode business-wide secretary_mode ('auto'|'ask_first'|'ghost')
 * @returns {'reply'|'silent'|'ask'}
 */
function resolveContactAction(replyMode, globalMode) {
  const mode = REPLY_MODES.includes(replyMode) ? replyMode : 'default';
  const effective = mode === 'default' ? (globalMode || 'ask_first') : mode;
  if (effective === 'silent' || effective === 'ghost') return 'silent';
  if (effective === 'ask_first') return 'ask';
  if (effective === 'auto') return 'reply';
  // Unknown explicit mode → treat as auto reply (mode was validated above).
  return 'reply';
}

/** Everything except an explicit "customer" is a personal (no-pitch) relation. */
function isPersonalRelation(relation) {
  return !!relation && relation !== 'customer';
}

/**
 * Build the per-person directive block injected into the secretary prompt.
 * Returns '' when there is nothing to add.
 */
function buildContactDirectives({ instructions, tone } = {}) {
  const lines = [];
  const ins = (instructions || '').trim();
  if (ins) lines.push(`Owner's standing orders for this person (follow exactly): ${ins.slice(0, 400)}`);
  const t = TONES.includes(tone) ? tone : 'default';
  if (t !== 'default') lines.push(`Tone with them: ${TONE_PHRASE[t]}.`);
  return lines.length ? `\n${lines.join('\n')}\n` : '';
}

module.exports = {
  RELATIONS, REPLY_MODES, TONES,
  resolveContactAction, isPersonalRelation, buildContactDirectives,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/web/src/lib/server/peoplePolicy.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/peoplePolicy.js apps/web/src/lib/server/peoplePolicy.test.js
git commit -m "feat(secretary): pure per-person policy module (reply action + directives)"
```

---

## Task 2: Inject per-person directives into the reply engine

**Files:**
- Modify: `apps/web/src/lib/server/replyEngine.js` (import; metadata seed ~5585-5604; `contactProfileLine` ~5842-5844)

This task has no standalone unit test (the reply engine is Supabase/Telegram-bound). The injected logic is `buildContactDirectives`, already covered by Task 1. Verification is by reading the diff and the build.

- [ ] **Step 1: Add the import near the other server-lib imports at the top of `replyEngine.js`**

`replyEngine.js` uses ESM `import` (see the import block at lines 18-35). Node and Next both resolve named imports from the CommonJS `peoplePolicy.js` via interop, so add this line alongside the existing imports:

```js
import { buildContactDirectives } from './peoplePolicy';
```

- [ ] **Step 2: Carry the saved instructions/tone into the contact profile metadata**

Find this block (around line 5589-5603, inside `if (knownPersonal) {`):

```js
        contact_profile: {
          ...cp0,
          name: cp0.name || knownPersonal.name || customer?.name || null,
          relationship: rel,
          // Owner-taught data (set in the People screen) is AUTHORITATIVE:
          // union the owner's nicknames with what we auto-learned, and let
          // owner-typed context win over the distilled notes.
          aliases: [...new Set([
            ...(Array.isArray(knownPersonal.aliases) ? knownPersonal.aliases : []),
            ...contactAliases(cp0),
          ].map(a => (a == null ? '' : String(a)).trim()).filter(Boolean))].slice(0, 8),
          notes: (knownPersonal.context && String(knownPersonal.context).trim())
            ? String(knownPersonal.context).trim().slice(0, 400)
            : cp0.notes,
        },
```

Add `instructions` and `tone` carry-through immediately after the `notes:` line, before the closing `},`:

```js
          notes: (knownPersonal.context && String(knownPersonal.context).trim())
            ? String(knownPersonal.context).trim().slice(0, 400)
            : cp0.notes,
          // Owner's per-person behavior controls (People screen). Authoritative.
          instructions: (knownPersonal.instructions && String(knownPersonal.instructions).trim())
            ? String(knownPersonal.instructions).trim().slice(0, 400)
            : cp0.instructions,
          tone: knownPersonal.tone || cp0.tone || 'default',
        },
```

- [ ] **Step 3: Append the directive block to the injected `contactProfileLine`**

Find this assignment (around line 5842-5844):

```js
        const contactProfileLine = cp && (cp.name || cpAliases.length || cp.notes || (cp.relationship && cp.relationship !== 'unknown'))
          ? `\n📇 WHO THIS IS (you know them — from your real past chats):${cp.name ? `\n- Name: ${cp.name}` : ''}${cpAliases.length ? `\n- You call them ${cpAliases.map(a => `"${a}"`).join(' or ')} — use one naturally now and then (whichever fits), but you're mid-conversation so don't open every message with it.` : ''}${cp.relationship && cp.relationship !== 'unknown' ? `\n- Relationship: ${cp.relationship}${cp.relationship !== 'customer' ? ' — this is personal; keep it warm and don\'t pitch the business unless they bring it up.' : ''}` : ''}${cp.notes ? `\n- Context: ${cp.notes}` : ''}\nMatch the tone and rhythm you usually use with THIS person — not a generic greeting.\n`
          : '';
```

Append `buildContactDirectives(cp)` to the built string by changing the trailing template so the directive block is concatenated after it:

```js
        const contactProfileLine = cp && (cp.name || cpAliases.length || cp.notes || (cp.relationship && cp.relationship !== 'unknown'))
          ? `\n📇 WHO THIS IS (you know them — from your real past chats):${cp.name ? `\n- Name: ${cp.name}` : ''}${cpAliases.length ? `\n- You call them ${cpAliases.map(a => `"${a}"`).join(' or ')} — use one naturally now and then (whichever fits), but you're mid-conversation so don't open every message with it.` : ''}${cp.relationship && cp.relationship !== 'unknown' ? `\n- Relationship: ${cp.relationship}${cp.relationship !== 'customer' ? ' — this is personal; keep it warm and don\'t pitch the business unless they bring it up.' : ''}` : ''}${cp.notes ? `\n- Context: ${cp.notes}` : ''}\nMatch the tone and rhythm you usually use with THIS person — not a generic greeting.\n${buildContactDirectives(cp)}`
          : buildContactDirectives(cp);
```

> Note: `cp` carries `instructions` and `tone` from Step 2. When there is no contact profile at all, the `: buildContactDirectives(cp)` branch returns `''` for a null `cp` because `buildContactDirectives` defaults its argument to `{}` — call it as `buildContactDirectives(cp || {})` in both places to be safe:
>
> - first occurrence: `...${buildContactDirectives(cp || {})}\``
> - second occurrence: `: buildContactDirectives(cp || {});`

- [ ] **Step 4: Verify the web build compiles**

Run: `cd apps/web && npx next build`
Expected: build completes without errors referencing `replyEngine.js` or `peoplePolicy`. (A pre-existing unrelated build warning is acceptable; a new error in these files is not.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/replyEngine.js
git commit -m "feat(secretary): inject per-person instructions and tone into prompt"
```

---

## Task 3: Apply per-person reply mode in the webhook

**Files:**
- Modify: `apps/web/src/app/api/agent-bot/webhook/route.js` (import; known-contact branch ~356-372)

- [ ] **Step 1: Add the import near the top imports of `route.js`**

Add alongside the existing `lib/server` imports:

```js
import { resolveContactAction } from '../../../../lib/server/peoplePolicy';
```

- [ ] **Step 2: Gate the known-contact branch on the resolved action**

Find this block (around line 356-372):

```js
      if (contactEntry) {
        // Known personal contact (family/friend). The owner wants the secretary
        // to chat with them too — warmly, context-aware, reading the history, and
        // never pitching the business. Route through the reply engine, which
        // detects the saved relationship and keeps the tone personal.
        console.log(`[agent-bot] personal contact (${contactEntry.relation}): ${senderName} — engaging personally`);
        maybeProposeReminder(business, bm.text, senderName).catch(() => {});
        if (chatId && bm.text && !bm.text.startsWith('/')) {
          tg('sendChatAction', { chat_id: chatId, action: 'typing', business_connection_id: connId }).catch(() => {});
        }
        try {
          await handleTenantUpdate(business, AGENT_TOKEN, update);
        } finally {
          if (chatId) clearBizConnId(String(chatId));
        }
        return NextResponse.json({ ok: true });
      }
```

Replace it with a version that resolves the per-person action first:

```js
      if (contactEntry) {
        // Known personal contact. The per-person reply_mode overrides the global
        // secretary_mode: 'silent' → forward to owner only; 'ask' → forward + let
        // the owner reply themselves; 'reply' → engage via the reply engine.
        const action = resolveContactAction(contactEntry.reply_mode, nPrefs.secretary_mode);
        console.log(`[agent-bot] personal contact (${contactEntry.relation}, mode=${contactEntry.reply_mode || 'default'} → ${action}): ${senderName}`);

        if (action === 'silent' || action === 'ask') {
          const ownerChat = business.owner_private_chat_id || business.owner_telegram_id;
          if (ownerChat && bm.text) {
            const tail = action === 'ask'
              ? '_You asked me to check first for them — reply yourself, I won\'t._'
              : '_Silent for them — I didn\'t reply._';
            tg('sendMessage', {
              chat_id: ownerChat, parse_mode: 'Markdown',
              text: `💬 *${senderName}:* ${(bm.text || '').slice(0, 300)}\n\n${tail}`,
            }).catch(() => {});
          }
          if (chatId) clearBizConnId(String(chatId));
          return NextResponse.json({ ok: true, action });
        }

        maybeProposeReminder(business, bm.text, senderName).catch(() => {});
        if (chatId && bm.text && !bm.text.startsWith('/')) {
          tg('sendChatAction', { chat_id: chatId, action: 'typing', business_connection_id: connId }).catch(() => {});
        }
        try {
          await handleTenantUpdate(business, AGENT_TOKEN, update);
        } finally {
          if (chatId) clearBizConnId(String(chatId));
        }
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 3: Verify the web build compiles**

Run: `cd apps/web && npx next build`
Expected: build completes; no new error referencing `route.js` or `peoplePolicy`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/agent-bot/webhook/route.js
git commit -m "feat(secretary): per-person reply mode overrides global (silent/ask/reply)"
```

---

## Task 4: Forward-to-add a person via `/personal`

**Files:**
- Modify: `apps/web/src/lib/server/replyEngine.js` (`/personal` handler ~2739-2784)

The `/personal` handler currently only lists/removes. When the owner forwards a message and sends `/personal`, capture the forwarded sender as a personal contact.

- [ ] **Step 1: Add a forward-capture branch at the top of the `/personal` handler**

Find the start of the handler (around line 2739-2743):

```js
    if (msg.text?.startsWith('/personal')) {
      const nPrefs = business.notification_prefs || {};
      const contacts = nPrefs.personal_contacts || [];

      const after = msg.text.replace(/^\/personal(@\S+)?\s*/, '').trim();
```

Insert a forward-capture block immediately after the `after` line, before the existing `if (after.startsWith('remove '))`:

```js
      const after = msg.text.replace(/^\/personal(@\S+)?\s*/, '').trim();

      // Forward + /personal → add the forwarded sender as a personal contact.
      // Telegram only gives us their numeric id when they allow forward links;
      // otherwise we get forward_sender_name with no id and cannot capture them.
      if (msg.forward_from || msg.forward_sender_name) {
        const fwdId = msg.forward_from?.id;
        if (!fwdId) {
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            parse_mode: 'Markdown',
            text: `🔒 I can't add *${msg.forward_sender_name || 'them'}* this way — their Telegram privacy hides their ID on forwards.\n\nThey'll be added automatically the next time they message you directly (I'll ask who they are).`,
          });
          return;
        }
        const fwdName = [msg.forward_from?.first_name, msg.forward_from?.last_name].filter(Boolean).join(' ')
          || msg.forward_from?.username || 'New contact';
        const idx = contacts.findIndex(c => String(c.telegram_id) === String(fwdId));
        if (idx >= 0) {
          contacts[idx] = { ...contacts[idx], name: contacts[idx].name || fwdName };
        } else {
          contacts.push({
            telegram_id: String(fwdId),
            name: fwdName,
            relation: 'friend',
            reply_mode: 'auto',
            aliases: [],
            context: '',
            instructions: '',
            tone: 'default',
            source: 'forward',
            added_at: new Date().toISOString(),
          });
        }
        await supabase().from('businesses').update({
          notification_prefs: { ...nPrefs, personal_contacts: contacts },
        }).eq('id', business.id);
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          parse_mode: 'Markdown',
          text: `✅ Added *${fwdName}* as a personal contact (friend, auto-reply).\n\nOpen the People screen to set their relation, tone, and standing instructions.`,
          reply_markup: { inline_keyboard: [[
            { text: '👥 Open People', web_app: { url: `${MINIAPP_BASE}/settings/people` } },
          ]] },
        });
        return;
      }
```

> `MINIAPP_BASE` is already defined at `replyEngine.js:37` (`const MINIAPP_BASE = process.env.NEXT_PUBLIC_APP_URL || ...`). Reuse it; do not introduce a new env read.

- [ ] **Step 2: Verify the web build compiles**

Run: `cd apps/web && npx next build`
Expected: build completes; no new error in `replyEngine.js`.

- [ ] **Step 3: Manual smoke check (documented, run when a Telegram test account is available)**

1. In Telegram, forward any message from a test person to `@MiniMeAgentBot`, then send `/personal`.
2. Expected: "✅ Added … as a personal contact" with an Open People button.
3. Re-open the People screen → the person appears with relation=friend, reply_mode=auto.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/replyEngine.js
git commit -m "feat(secretary): forward a message + /personal to add a personal contact"
```

---

## Task 5: People page — per-person controls

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/people/page.js`

- [ ] **Step 1: Normalize the new fields when loading contacts**

Find the `useEffect` that maps `raw` (around line 43-54) and replace its body so all new fields are read:

```js
  useEffect(() => {
    if (!business) return;
    const raw = business.notification_prefs?.personal_contacts || [];
    setContacts(raw.map(c => ({
      telegram_id: c.telegram_id,
      name: c.name || '',
      relation: ['family', 'friend', 'colleague', 'customer', 'vip', 'other'].includes(c.relation) ? c.relation : 'friend',
      reply_mode: ['default', 'auto', 'ask_first', 'silent'].includes(c.reply_mode) ? c.reply_mode : 'default',
      tone: ['default', 'warm', 'formal', 'playful', 'brief'].includes(c.tone) ? c.tone : 'default',
      aliasesText: Array.isArray(c.aliases) ? c.aliases.join(', ') : (c.address_as || ''),
      context: c.context || '',
      instructions: c.instructions || '',
    })));
  }, [business?.id]); // eslint-disable-line
```

- [ ] **Step 2: Persist the new fields on save**

Find the `save()` function's `cleaned` map (around line 72-79) and replace it:

```js
    const cleaned = contacts.map(c => ({
      telegram_id: c.telegram_id,
      name: (c.name || '').trim().slice(0, 80),
      relation: ['family', 'friend', 'colleague', 'customer', 'vip', 'other'].includes(c.relation) ? c.relation : 'friend',
      reply_mode: ['default', 'auto', 'ask_first', 'silent'].includes(c.reply_mode) ? c.reply_mode : 'default',
      tone: ['default', 'warm', 'formal', 'playful', 'brief'].includes(c.tone) ? c.tone : 'default',
      aliases: (c.aliasesText || '')
        .split(',').map(a => a.trim()).filter(Boolean).slice(0, 8),
      context: (c.context || '').trim().slice(0, 400),
      instructions: (c.instructions || '').trim().slice(0, 400),
    }));
```

- [ ] **Step 3: Replace the family/friend pills with a relation dropdown + add reply-mode + tone rows**

Find the relation pills block (around line 139-142):

```js
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={() => update(idx, 'relation', 'family')} style={pill(c.relation === 'family')}>👨‍👩‍👧 Family</button>
              <button onClick={() => update(idx, 'relation', 'friend')} style={pill(c.relation === 'friend')}>👫 Friend</button>
            </div>
```

Replace it with a relation `<select>` plus reply-mode and tone pill rows:

```js
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
              Relationship
            </label>
            <select
              value={c.relation}
              onChange={e => update(idx, 'relation', e.target.value)}
              style={{ ...INPUT, marginBottom: 12 }}
            >
              <option value="family">👨‍👩‍👧 Family</option>
              <option value="friend">👫 Friend</option>
              <option value="colleague">💼 Colleague</option>
              <option value="vip">⭐ VIP</option>
              <option value="customer">🛒 Customer</option>
              <option value="other">• Other</option>
            </select>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
              When they message
            </label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              {[['default', 'Default'], ['auto', 'Auto-reply'], ['ask_first', 'Ask first'], ['silent', 'Silent']].map(([val, label]) => (
                <button key={val} onClick={() => update(idx, 'reply_mode', val)} style={pill(c.reply_mode === val)}>{label}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 12, lineHeight: 1.4 }}>
              Default follows your global secretary mode. Auto replies as you. Ask first / Silent never auto-reply — I just tell you.
            </div>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
              Tone
            </label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {[['default', 'Default'], ['warm', 'Warm'], ['formal', 'Formal'], ['playful', 'Playful'], ['brief', 'Brief']].map(([val, label]) => (
                <button key={val} onClick={() => update(idx, 'tone', val)} style={pill(c.tone === val)}>{label}</button>
              ))}
            </div>
```

- [ ] **Step 4: Update the card emoji to cover all relations and add an instructions textarea**

Find the card emoji span (around line 124):

```js
              <span style={{ fontSize: 20 }}>{c.relation === 'family' ? '👨‍👩‍👧' : '👫'}</span>
```

Replace with a lookup covering all relations:

```js
              <span style={{ fontSize: 20 }}>{({ family: '👨‍👩‍👧', friend: '👫', colleague: '💼', vip: '⭐', customer: '🛒', other: '•' })[c.relation] || '👫'}</span>
```

Then find the end of the existing "Things to remember" (context) textarea block (around line 167-169):

```js
            <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 4, lineHeight: 1.4 }}>
              Context that helps the secretary sound like you — ongoing topics, plans, sensitivities.
            </div>
```

Add an instructions field immediately after that closing `</div>` (still inside the card `<div>`):

```js
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '12px 0 5px' }}>
              Standing instructions
            </label>
            <textarea
              value={c.instructions}
              onChange={e => update(idx, 'instructions', e.target.value)}
              rows={2}
              style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }}
              placeholder="e.g. Always be formal. Never discuss prices. If they mention the wedding, tell me."
            />
            <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 4, lineHeight: 1.4 }}>
              Orders for how I act with them — followed exactly, on top of everything else.
            </div>
```

- [ ] **Step 5: Verify the web build compiles**

Run: `cd apps/web && npx next build`
Expected: build completes; the People page compiles with no error.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/settings/people/page.js"
git commit -m "feat(secretary): People page per-person relation, reply mode, tone, instructions"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Data model (relation/reply_mode/instructions/tone/source) → Task 1 (constants/validation), Task 4 (write on add), Task 5 (read/write in UI).
  - Reply-mode resolution overriding global → Task 1 (`resolveContactAction`) + Task 3 (webhook gate).
  - Prompt injection of instructions/tone → Task 2.
  - Forward-to-add with privacy fallback → Task 4.
  - People page all-relations + new controls → Task 5.
- **Type consistency:** `resolveContactAction` returns `'reply'|'silent'|'ask'` — consumed only in Task 3 with exactly those strings. Enum arrays in Task 1, Task 5 load, and Task 5 save are identical.
- **No DB migration** — all fields live in the existing `notification_prefs` JSONB; legacy entries default safely on load (Task 5 Step 1) and in the engine (Task 2 reads `cp.tone || 'default'`).
- **Known limitation (in scope, documented):** for a known contact, `ask_first` and `silent` both result in "don't reply, tell the owner" (no per-message draft-approval UI for personal contacts in v1). The framing differs. Full per-person draft approval is deferred to a later spec.
```
