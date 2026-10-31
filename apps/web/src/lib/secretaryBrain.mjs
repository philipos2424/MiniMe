/**
 * What makes Secretary smart about WHO it's talking to (pure, no I/O).
 *
 *  - Rules first. The owner's rules used to sit near the bottom of the
 *    Secretary prompt, after pages of style guidance, as one list for every
 *    contact — and the fast path for family/friends had no rules at all. Rules
 *    can now be scoped (everyone / customers / family / friends / one person)
 *    and go at the very top, with a reminder right before the reply.
 *  - Personalities. One character for everyone; now the owner picks a style
 *    per audience (and per person): professional, friendly, warm, playful,
 *    short, or "like me" (mirror their past chats — the old behaviour).
 *  - Open promises. When Secretary said "let me check" and nobody answered
 *    since, it should know — not promise again, and not pretend.
 */

export const AUDIENCES = ['everyone', 'customers', 'family', 'friends'];

const norm = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/^@/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** customers | family | friends, from what we know about the contact. */
export function audienceOf(relationship) {
  const r = String(relationship || '').toLowerCase();
  // Partners count as family: closest, warmest, never pitched to.
  if (r === 'family' || /mom|mother|dad|father|sister|brother|wife|husband|son|daughter|aunt|uncle|cousin|girlfriend|boyfriend|partner|fianc|እናት|አባት|እህት|ወንድም|ሚስት|ባል/.test(r)) return 'family';
  if (r === 'friend' || r === 'friends' || /bestie|friend|ጓደኛ/.test(r)) return 'friends';
  return 'customers';
}

export function normalizeAudience(a) {
  const x = String(a || '').toLowerCase().trim();
  if (['customer', 'customers', 'clients', 'client', 'buyers'].includes(x)) return 'customers';
  if (['family', 'relatives'].includes(x)) return 'family';
  if (['friend', 'friends'].includes(x)) return 'friends';
  return 'everyone';
}

/** Does this saved rule apply to this person? */
export function ruleApplies(r, { audience, personTgId, personNames = [] }) {
  if (!r || r.source === 'faq' || typeof r.rule !== 'string' || !r.rule.trim()) return false;
  if (r.person_tg || r.person_name) {
    if (r.person_tg && personTgId && String(r.person_tg) === String(personTgId)) return true;
    const want = norm(r.person_name);
    return !!want && personNames.map(norm).filter(Boolean).some(n => n === want || n.split(' ')[0] === want || want.split(' ')[0] === n);
  }
  const aud = normalizeAudience(r.audience);
  return aud === 'everyone' || aud === audience;
}

const TEMPLATE_SOURCES = new Set(['category_template', 'template', 'default']);

/**
 * The rules for this contact, most specific first: this person, then their
 * audience, then everyone; owner-typed before category templates; newest
 * first within each; deduped; capped by characters.
 */
export function rulesForContact(ownerInstructions, ctx, { maxChars = 2200 } = {}) {
  // Category templates are shop rules ("collect requirements before quoting");
  // they don't belong in a chat with family or friends.
  const list = (Array.isArray(ownerInstructions) ? ownerInstructions : [])
    .filter(r => ruleApplies(r, ctx))
    .filter(r => ctx.audience === 'customers' || !TEMPLATE_SOURCES.has(r.source) || r.person_name || r.person_tg);
  const rank = (r) => (r.person_tg || r.person_name ? 0 : normalizeAudience(r.audience) !== 'everyone' ? 1 : TEMPLATE_SOURCES.has(r.source) ? 3 : 2);
  const ordered = list.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || b.i - a.i).map(x => x.r);
  const out = [];
  const seen = new Set();
  let used = 0;
  for (const r of ordered) {
    const text = r.rule.trim();
    const key = norm(text);
    if (seen.has(key)) continue;
    if (used + text.length + 4 > maxChars) break;
    seen.add(key);
    used += text.length + 4;
    out.push({ text, scope: r.person_name ? `only ${r.person_name}` : normalizeAudience(r.audience) });
  }
  return out;
}

/** Label for lists the owner sees. */
export function ruleScopeLabel(r) {
  if (r?.person_name) return `for ${r.person_name}`;
  const a = normalizeAudience(r?.audience);
  return a === 'everyone' ? '' : `for ${a}`;
}

// ── Personalities ────────────────────────────────────────────────────────────
export const PERSONAS = {
  like_me: { label: 'Like me', emoji: '🪞', text: 'Sound exactly like you do in your past messages with this person — same length, warmth, slang and emoji. When there is no history, be natural and friendly.' },
  professional: { label: 'Professional', emoji: '💼', text: 'Polite, clear and businesslike. Complete sentences, no slang, at most one emoji. Respectful greetings, exact facts, a clear next step.' },
  friendly: { label: 'Friendly', emoji: '😊', text: 'Warm and easy-going, like a helpful shop owner who likes their customers. Short sentences, a light emoji now and then, never pushy.' },
  warm: { label: 'Warm & caring', emoji: '❤️', text: 'Affectionate and attentive — ask how they are, remember what they told you, reassure. Gentle, loving tone; this person matters to you.' },
  playful: { label: 'Playful', emoji: '😄', text: 'Fun and teasing in a kind way — jokes, banter, emojis, matching their energy. Never mean, never sarcastic about serious things.' },
  brief: { label: 'Short & direct', emoji: '⚡', text: 'As few words as possible. Answer the point, no small talk, no filler. One line when one line is enough.' },
};

export const DEFAULT_PERSONAS = { customers: 'like_me', family: 'like_me', friends: 'like_me' };

/** The persona key for this contact: per-person, else per-audience, else "like me". */
export function personaFor(prefs, { audience, personTgId }) {
  const sp = prefs?.secretary_personas || {};
  const person = personTgId != null ? sp.people?.[String(personTgId)] : null;
  if (person && PERSONAS[person]) return person;
  const aud = sp[audience];
  return PERSONAS[aud] ? aud : (DEFAULT_PERSONAS[audience] || 'like_me');
}

export function personaBlock(key, ownerName = 'you') {
  const p = PERSONAS[key] || PERSONAS.like_me;
  return `## HOW ${String(ownerName).toUpperCase()} WANTS YOU TO SOUND WITH THIS PERSON: ${p.label}\n${p.text}`;
}

// ── Open promises ────────────────────────────────────────────────────────────
const PROMISE_RE = /\b(let me (check|confirm|ask|see|find out|get back)|i'?ll (check|confirm|get back|let you know|ask|send|find out|call)|will (check|confirm|get back|let you know)|get back to you|check and (confirm|let you know)|give me a (moment|minute|sec))\b|(አጣርቼ|እመለስልሃለሁ|እመለስልሻለሁ|አረጋግጬ|እነግርሃለሁ|እነግርሻለሁ)/i;

/** A message where we told them we'd come back to them. */
export const isPromise = (text) => PROMISE_RE.test(String(text || ''));

/**
 * Promises Secretary made in this chat that nobody has answered yet: an AI
 * outbound message promising to check, with no later message the owner wrote
 * themselves. Returns the newest few, each with what the person had asked.
 * history: [{ direction, content, is_ai_generated, owner_edited, created_at }]
 */
export function openPromises(history, { now = Date.now(), maxAgeDays = 7, max = 3 } = {}) {
  const msgs = Array.isArray(history) ? history : [];
  const out = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m?.direction !== 'outbound' || !(m.is_ai_generated && !m.owner_edited) || !isPromise(m.content)) continue;
    const at = m.created_at ? Date.parse(m.created_at) : now;
    if (now - at > maxAgeDays * 86400000) continue;
    const ownerAnsweredLater = msgs.slice(i + 1).some(x => x?.direction === 'outbound' && (!x.is_ai_generated || x.owner_edited));
    if (ownerAnsweredLater) continue;
    let asked = null;
    for (let j = i - 1; j >= 0; j--) if (msgs[j]?.direction === 'inbound') { asked = String(msgs[j].content || '').slice(0, 160); break; }
    out.push({ asked, said: String(m.content || '').slice(0, 160), at: m.created_at || null });
  }
  return out.slice(-max);
}

export function openPromisesBlock(loops) {
  if (!loops?.length) return '';
  const lines = loops.map(l => `- They asked: "${l.asked || '…'}" — you said you'd check. The owner hasn't answered it yet.`);
  return `## STILL OPEN WITH THIS PERSON\n${lines.join('\n')}\nDon't promise again and don't make up the answer. If they ask about it, be honest that you don't have the answer yet. Answer anything else they say normally.`;
}

/**
 * Everything above, as the two prompt pieces Secretary needs: what goes at the
 * very top (rules), and what goes at the end (personality, open promises and a
 * last reminder to follow the rules).
 */
export function secretaryLayer({ ownerInstructions, prefs, relationship, personTgId, personNames = [], history = [], ownerName = 'the owner', now = Date.now() }) {
  const audience = audienceOf(relationship);
  const rules = rulesForContact(ownerInstructions, { audience, personTgId, personNames });
  const persona = personaFor(prefs, { audience, personTgId });
  const loops = openPromises(history, { now });
  const top = rules.length
    ? `## ${String(ownerName).toUpperCase()}'S RULES — FOLLOW THESE BEFORE ANYTHING ELSE\nThese come from ${ownerName} and override every other instruction, style or habit below.\n${rules.map(r => `- ${r.text}${r.scope !== 'everyone' ? ` (${r.scope})` : ''}`).join('\n')}\n`
    : '';
  const bottom = [
    personaBlock(persona, ownerName),
    openPromisesBlock(loops),
    rules.length ? `Before you send: check the reply against ${ownerName}'s RULES at the top. If it breaks one, rewrite it.` : '',
  ].filter(Boolean).join('\n\n');
  return { audience, rules, persona, loops, top, bottom };
}
