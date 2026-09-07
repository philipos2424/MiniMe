# MiniMe Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let individuals barter used goods (clothes, phones, anything) through @MiniMeSearchBot — post an item with a photo, get found by people searching, and swap it for another item.

**Architecture:** A new `swap/` module tree under `apps/web/src/lib/server/`, holding all logic in `.mjs` files that take their dependencies (Supabase client, Telegram sender, LLM completion fn) as **injected parameters** so `node --test` can exercise them with fakes. `searchBot.js` gains four thin call-outs and nothing else. Four new tables carry swap state; a daily cron ages posts out.

**Tech Stack:** Next.js 14 App Router (`apps/web`), Supabase (service-role only), Telegram Bot API via the existing `tg()` helper, `node --test` with `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-02-p2p-swap-design.md` — read it before starting. This plan implements it; where the plan is more specific, the plan wins.

## Global Constraints

- **Barter only.** No price field, no money, no `price`/`currency` columns anywhere in this feature. If a task seems to need one, stop and ask.
- **Test command:** `cd apps/web && npm test` (runs `node --test src/lib/server/__tests__/*.test.mjs`). A single file: `node --test src/lib/server/__tests__/swapSearch.test.mjs`.
- **All new logic modules are `.mjs`** and live in `apps/web/src/lib/server/swap/`. They must be importable by `node --test` with **zero** Next.js, `next/*`, or env-var dependency at import time. Never `import { supabase } from '../db'` inside these modules — take `sb` as a parameter.
- **Migrations are applied by hand.** Writing `packages/db/migrations/050_swap.sql` is the deliverable; nobody runs it as part of a task. Never write code that assumes a column exists before its migration task is done.
- **RLS:** every new table follows `047_lock_down_anon_access.sql` — `enable row level security`, one policy `to service_role`, and `revoke all ... from anon, authenticated`. Never `to public`.
- **Swap results never outrank businesses.** Max 3 swap cards per result set, always appended after the business block, suppressed on commercial queries.
- **Language:** replies mirror the user's script using `detectScript()` from `../amharicScript.mjs` (it handles Latin-script Amharic — do not write a new `/[ሀ-፿]/` test).
- **Callback data prefix is `sw:`** for everything in this feature. `sb:` belongs to existing search. Telegram caps `callback_data` at 64 bytes — keep payloads short.
- **Commit after every task**, message prefixed `swap: `.

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/050_swap.sql` | Four tables, indexes, RLS |
| `apps/web/src/lib/server/swap/constants.mjs` | Every tunable number in one place |
| `apps/web/src/lib/server/swap/swapAreas.mjs` | Area list, keyboard, normalization |
| `apps/web/src/lib/server/swap/swapParse.mjs` | LLM parse of title/wants → keywords + banned check |
| `apps/web/src/lib/server/swap/swapPost.mjs` | Posting wizard state machine + publish |
| `apps/web/src/lib/server/swap/swapSearch.mjs` | Both discovery blocks, placement rules, formatting |
| `apps/web/src/lib/server/swap/swapInterest.mjs` | Offer line, handle reveal, reports |
| `apps/web/src/lib/server/swap/swapLifecycle.mjs` | Expiry + completion prompts |
| `apps/web/src/app/api/cron/swap-lifecycle/route.js` | Daily job entry point |
| `apps/web/src/lib/server/searchBot.js` | 4 integration points, thin |

Task order is dependency order. Tasks 2–7 each end green and committed.

---

### Task 1: Database schema

**Files:**
- Create: `packages/db/migrations/050_swap.sql`
- Create: `apps/web/src/lib/server/swap/constants.mjs`
- Test: none (SQL is applied by hand; constants are asserted by later tasks)

**Interfaces:**
- Consumes: nothing.
- Produces: the four tables below, and `constants.mjs` exporting `MAX_PHOTOS = 3`, `MAX_SWAP_CARDS = 3`, `EXPIRY_DAYS = 21`, `COMPLETION_DELAY_DAYS = 3`, `REVEALS_PER_DAY = 10`, `REPORTS_TO_HIDE = 3`, `DRAFT_TTL_MINUTES = 60`, `MAX_TEXT = 120`.

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/050_swap.sql`:

```sql
-- 050_swap.sql
--
-- MiniMe Swap: peer-to-peer barter inside MiniMe Search.
--
-- These are the first tables in the schema keyed to a PERSON rather than a
-- business. A swap lister has no businesses row, no bot token and no shop
-- code — only a Telegram user id. That is deliberate: requiring onboarding
-- would defeat the point of a 30-second post.
--
-- No price column anywhere, by design. A swap post's price is another item
-- (wants_text); adding money here would turn this into classifieds and drag
-- MiniMe into payments it does not process.

begin;

create table if not exists swap_items (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  telegram_username text,
  title text not null,
  wants_text text not null,
  condition text not null check (condition in ('like_new','good','worn','parts')),
  area text not null,
  area_is_freetext boolean not null default false,
  photo_file_ids text[] not null,
  category text,
  keywords text[] not null default '{}',
  want_category text,
  want_keywords text[] not null default '{}',
  lang text not null default 'en',
  status text not null default 'active' check (status in ('active','hidden','swapped','expired')),
  view_count int not null default 0,
  interest_count int not null default 0,
  first_reveal_at timestamptz,
  completion_asked_at timestamptz,
  expiry_asked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists swap_items_keywords_idx      on swap_items using gin (keywords);
create index if not exists swap_items_want_keywords_idx on swap_items using gin (want_keywords);
create index if not exists swap_items_status_expiry_idx on swap_items (status, expires_at);
create index if not exists swap_items_user_idx          on swap_items (telegram_user_id, status);

create table if not exists swap_interests (
  id uuid primary key default gen_random_uuid(),
  swap_item_id uuid not null references swap_items(id) on delete cascade,
  from_telegram_user_id bigint not null,
  from_telegram_username text,
  offer_text text not null,
  asked_completion_at timestamptz,
  confirmed_swapped boolean,
  created_at timestamptz not null default now(),
  unique (swap_item_id, from_telegram_user_id)
);

create index if not exists swap_interests_item_idx on swap_interests (swap_item_id);

create table if not exists swap_reports (
  id uuid primary key default gen_random_uuid(),
  swap_item_id uuid not null references swap_items(id) on delete cascade,
  reported_telegram_user_id bigint not null,
  reporter_telegram_user_id bigint not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (swap_item_id, reporter_telegram_user_id)
);

create index if not exists swap_reports_reported_idx on swap_reports (reported_telegram_user_id);

-- Draft state is in Postgres, not an in-memory Map. The posting wizard is four
-- steps; on Vercel the instance that received step 1 is not guaranteed to
-- receive step 2, and losing a half-finished post is the one failure a first
-- time lister will not retry.
create table if not exists swap_drafts (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  step text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table swap_items     enable row level security;
alter table swap_interests enable row level security;
alter table swap_reports   enable row level security;
alter table swap_drafts    enable row level security;

create policy swap_items_service     on swap_items     for all to service_role using (true) with check (true);
create policy swap_interests_service on swap_interests for all to service_role using (true) with check (true);
create policy swap_reports_service   on swap_reports   for all to service_role using (true) with check (true);
create policy swap_drafts_service    on swap_drafts    for all to service_role using (true) with check (true);

revoke all on swap_items, swap_interests, swap_reports, swap_drafts from anon, authenticated;

commit;
```

- [ ] **Step 2: Write the constants module**

Create `apps/web/src/lib/server/swap/constants.mjs`:

```js
/**
 * Every tunable number for MiniMe Swap, in one place.
 *
 * These are product decisions, not implementation details — MAX_SWAP_CARDS in
 * particular is a commercial guardrail (businesses pay, swaps do not), so it
 * lives somewhere a reviewer can find it rather than inline in a query.
 */
export const MAX_PHOTOS = 3;
export const MAX_TEXT = 120;
export const MAX_SWAP_CARDS = 3;
export const EXPIRY_DAYS = 21;
export const COMPLETION_DELAY_DAYS = 3;
export const REVEALS_PER_DAY = 10;
export const REPORTS_TO_HIDE = 3;
export const DRAFT_TTL_MINUTES = 60;

export const CONDITIONS = ['like_new', 'good', 'worn', 'parts'];

export const CONDITION_LABELS = {
  like_new: { en: 'Like new', am: 'እንደ አዲስ' },
  good:     { en: 'Good',     am: 'ጥሩ' },
  worn:     { en: 'Worn',     am: 'ያገለገለ' },
  parts:    { en: 'For parts', am: 'ለመለዋወጫ' },
};
```

- [ ] **Step 3: Verify the SQL parses**

There is no local Postgres, so verification is a read-through, not a run. Confirm by eye:
- every `create table` has `if not exists`
- all four tables appear in the `enable row level security` block, the policy block, and the `revoke`
- no column named `price`, `amount`, or `currency` exists

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/050_swap.sql apps/web/src/lib/server/swap/constants.mjs
git commit -m "swap: schema for items, interests, reports and drafts"
```

---

### Task 2: Areas

**Files:**
- Create: `apps/web/src/lib/server/swap/swapAreas.mjs`
- Test: `apps/web/src/lib/server/__tests__/swapAreas.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `AREAS: Array<{ id: string, en: string, am: string }>`
  - `areaLabel(id: string, lang: 'en'|'am'): string` — falls back to the raw id for free-text areas
  - `normalizeArea(text: string): { area: string, isFreetext: boolean }`
  - `areaKeyboard(lang: 'en'|'am'): Array<Array<{text: string, callback_data: string}>>` — rows of 2, plus a final row with `sw:area:other`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/__tests__/swapAreas.test.mjs`:

```js
/**
 * Areas are buttons, but the button list is Addis-centric and always will be
 * on day one. What must not happen is a lister in Hawassa hitting a wall at
 * step four — hence normalizeArea's free-text branch, which is the reason
 * this module exists instead of a hardcoded array in the wizard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, areaLabel, normalizeArea, areaKeyboard } from '../swap/swapAreas.mjs';

test('known areas normalize to their id regardless of case or script', () => {
  assert.deepEqual(normalizeArea('Bole'),  { area: 'bole', isFreetext: false });
  assert.deepEqual(normalizeArea('  bole '), { area: 'bole', isFreetext: false });
  assert.deepEqual(normalizeArea('ቦሌ'),   { area: 'bole', isFreetext: false });
});

test('an unknown place is kept as free text rather than rejected', () => {
  const r = normalizeArea('Hawassa Piazza');
  assert.equal(r.isFreetext, true);
  assert.equal(r.area, 'Hawassa Piazza');
});

test('free text is trimmed and length-capped so it cannot bloat a card', () => {
  const r = normalizeArea('  ' + 'x'.repeat(200) + '  ');
  assert.equal(r.area.length, 60);
});

test('areaLabel renders Amharic when asked and falls back to free text', () => {
  assert.equal(areaLabel('bole', 'en'), 'Bole');
  assert.equal(areaLabel('bole', 'am'), 'ቦሌ');
  assert.equal(areaLabel('Hawassa Piazza', 'en'), 'Hawassa Piazza');
});

test('the keyboard offers every area plus an escape hatch', () => {
  const kb = areaKeyboard('en');
  const flat = kb.flat();
  assert.equal(flat.length, AREAS.length + 1);
  assert.ok(flat.every(b => b.callback_data.startsWith('sw:area:')));
  assert.equal(flat.at(-1).callback_data, 'sw:area:other');
  assert.ok(kb.every(row => row.length <= 2));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapAreas.test.mjs`
Expected: FAIL — `Cannot find module '../swap/swapAreas.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/server/swap/swapAreas.mjs`:

```js
/**
 * Where a swap can be collected.
 *
 * Buttons cover the Addis areas that actually generate MiniMe traffic; anything
 * else is stored as free text via `sw:area:other`. The free-text values are the
 * signal for which cities to promote to buttons later — so they are stored as
 * typed, not silently dropped into an "other" bucket that answers nothing.
 */
export const AREAS = [
  { id: 'bole',       en: 'Bole',       am: 'ቦሌ' },
  { id: 'piassa',     en: 'Piassa',     am: 'ፒያሳ' },
  { id: 'megenagna',  en: 'Megenagna',  am: 'መገናኛ' },
  { id: 'four_kilo',  en: '4 Kilo',     am: '4 ኪሎ' },
  { id: 'six_kilo',   en: '6 Kilo',     am: '6 ኪሎ' },
  { id: 'mexico',     en: 'Mexico',     am: 'ሜክሲኮ' },
  { id: 'kazanchis',  en: 'Kazanchis',  am: 'ካዛንቺስ' },
  { id: 'sarbet',     en: 'Sarbet',     am: 'ሳርቤት' },
  { id: 'gerji',      en: 'Gerji',      am: 'ገርጂ' },
  { id: 'ayat',       en: 'Ayat',       am: 'አያት' },
];

const MAX_FREETEXT = 60;

const BY_ALIAS = new Map();
for (const a of AREAS) {
  BY_ALIAS.set(a.id, a.id);
  BY_ALIAS.set(a.en.toLowerCase(), a.id);
  BY_ALIAS.set(a.am, a.id);
}

/** Display name for an area id, or the free-text value unchanged. */
export function areaLabel(area, lang = 'en') {
  const known = AREAS.find(a => a.id === area);
  if (!known) return area;
  return lang === 'am' ? known.am : known.en;
}

/** Map typed or tapped input to a known area id, else keep it as free text. */
export function normalizeArea(text) {
  const raw = String(text || '').trim();
  const hit = BY_ALIAS.get(raw.toLowerCase()) || BY_ALIAS.get(raw);
  if (hit) return { area: hit, isFreetext: false };
  return { area: raw.slice(0, MAX_FREETEXT), isFreetext: true };
}

/** Two-per-row area buttons, with the free-text escape hatch last. */
export function areaKeyboard(lang = 'en') {
  const rows = [];
  for (let i = 0; i < AREAS.length; i += 2) {
    rows.push(AREAS.slice(i, i + 2).map(a => ({
      text: lang === 'am' ? a.am : a.en,
      callback_data: `sw:area:${a.id}`,
    })));
  }
  rows.push([{
    text: lang === 'am' ? 'ሌላ ቦታ — ይጻፉ' : 'Somewhere else — type it',
    callback_data: 'sw:area:other',
  }]);
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapAreas.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/swap/swapAreas.mjs apps/web/src/lib/server/__tests__/swapAreas.test.mjs
git commit -m "swap: area list with free-text fallback"
```

---

### Task 3: Parsing a swap post

**Files:**
- Create: `apps/web/src/lib/server/swap/swapParse.mjs`
- Test: `apps/web/src/lib/server/__tests__/swapParse.test.mjs`

**Interfaces:**
- Consumes: `translationsOf` from `../termTranslations.mjs`, `detectScript` from `../amharicScript.mjs`.
- Produces:
  - `parseSwapText(text: string, opts?: { complete?: Function }): Promise<{ category: string|null, keywords: string[], banned: string|null }>` — `banned` is a short human reason or `null`. `complete` is injected for tests; in production it lazily imports `loggedCompletion`.
  - `expandKeywords(keywords: string[]): string[]` — adds cross-language variants, deduped, lowercased.
  - `postLang(text: string): 'en'|'am'` — `'am'` for `ethiopic`/`latin-am`, else `'en'`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/__tests__/swapParse.test.mjs`:

```js
/**
 * The parse is what makes a swap findable, and it runs on BOTH halves of the
 * post: the item and the wants. The reverse index in swapSearch is only as
 * good as the keywords extracted from "winter jacket or a good watch".
 *
 * The LLM is injected rather than imported so these tests never hit the
 * network — a swap post must not depend on OpenAI being reachable to be
 * testable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSwapText, expandKeywords, postLang } from '../swap/swapParse.mjs';

/** Fake `loggedCompletion` returning whatever JSON the test names. */
function fakeLLM(payload, onCall) {
  return async (args) => {
    onCall?.(args);
    return { choices: [{ message: { content: JSON.stringify(payload) } }] };
  };
}

test('extracts category and keywords from an item description', async () => {
  const r = await parseSwapText('Redmi Note 10, 128gb, small crack', {
    complete: fakeLLM({ category: 'electronics_phones', keywords: ['phone', 'redmi'], banned: null }),
  });
  assert.equal(r.category, 'electronics_phones');
  assert.ok(r.keywords.includes('phone'));
  assert.equal(r.banned, null);
});

test('a banned item is refused with a reason and no keywords survive', async () => {
  const r = await parseSwapText('AK47 magazine', {
    complete: fakeLLM({ category: null, keywords: ['gun'], banned: 'weapons' }),
  });
  assert.equal(r.banned, 'weapons');
  assert.deepEqual(r.keywords, []);
});

test('an unparseable LLM reply degrades to empty, never throws', async () => {
  const complete = async () => ({ choices: [{ message: { content: 'not json' } }] });
  const r = await parseSwapText('anything', { complete });
  assert.deepEqual(r, { category: null, keywords: [], banned: null });
});

test('a thrown LLM call degrades to empty, never throws', async () => {
  const complete = async () => { throw new Error('network down'); };
  const r = await parseSwapText('anything', { complete });
  assert.deepEqual(r, { category: null, keywords: [], banned: null });
});

test('keywords are capped so one post cannot dominate the index', async () => {
  const many = Array.from({ length: 30 }, (_, i) => `k${i}`);
  const r = await parseSwapText('x', { complete: fakeLLM({ category: null, keywords: many, banned: null }) });
  assert.ok(r.keywords.length <= 8, `got ${r.keywords.length}`);
});

test('expandKeywords bridges scripts so Amharic and English find each other', () => {
  const out = expandKeywords(['jacket']);
  assert.ok(out.includes('jacket'));
  assert.ok(out.length >= 1);
  assert.deepEqual(out, [...new Set(out)], 'no duplicates');
  assert.ok(out.every(k => k === k.toLowerCase()));
});

test('postLang mirrors the script the lister actually typed in', () => {
  assert.equal(postLang('ጃኬት እፈልጋለሁ'), 'am');
  assert.equal(postLang('winter jacket'), 'en');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapParse.test.mjs`
Expected: FAIL — `Cannot find module '../swap/swapParse.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/server/swap/swapParse.mjs`:

```js
/**
 * One LLM call per line of a swap post — the item and the wants each get
 * parsed the same way, because in barter the wants line is the price and has
 * to be as searchable as the item itself.
 *
 * The same call enforces the banned list. Doing it here rather than in a
 * second pass means a refused post costs one call, not two, and a model that
 * fails open (returns nothing) refuses nothing — the fallback is an empty
 * parse, never a banned=false claim we did not earn.
 */
import { translationsOf } from '../termTranslations.mjs';
import { detectScript } from '../amharicScript.mjs';

const MAX_KEYWORDS = 8;

const BANNED = 'weapons, ammunition, drugs or medicine, currency or money, ID or government documents, live animals, human body parts, stolen goods';

const SYSTEM = `You parse one line from a barter post on an Ethiopian swap board. Input may be English or Amharic.
Return JSON with:
- category: the best-fitting broad category id (lowercase snake_case, e.g. "electronics_phones", "clothing_fashion", "home_furniture") or null
- keywords: 1-6 specific lowercase ENGLISH nouns someone would search for (e.g. ["phone","redmi"]). No adjectives, no brands-only.
- banned: if the item is one of [${BANNED}], a one-word reason such as "weapons" or "medicine". Otherwise null.
Return JSON only.`;

/** Lazily reach for the real LLM so this module stays importable under node --test. */
async function defaultComplete(args) {
  const [{ loggedCompletion }, { SEARCH_MODEL }] = await Promise.all([
    import('../openai-wrapper.js'),
    import('../constants.js'),
  ]);
  return loggedCompletion({ model: SEARCH_MODEL, ...args });
}

/**
 * Parse one line of a swap post.
 * Never throws: a failed parse yields an unfindable post, which is recoverable;
 * a thrown error yields a lost post, which is not.
 */
export async function parseSwapText(text, { complete = defaultComplete } = {}) {
  const empty = { category: null, keywords: [], banned: null };
  try {
    const res = await complete({
      route: 'swap_parse', temperature: 0.1, max_tokens: 150,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: String(text || '').slice(0, 200) },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content);
    const banned = raw.banned ? String(raw.banned).slice(0, 40) : null;
    if (banned) return { category: null, keywords: [], banned };
    const keywords = Array.isArray(raw.keywords)
      ? [...new Set(raw.keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean))].slice(0, MAX_KEYWORDS)
      : [];
    return { category: raw.category ? String(raw.category) : null, keywords, banned: null };
  } catch (e) {
    console.warn('[swap] parse failed:', e.message);
    return empty;
  }
}

/** Add cross-script variants so "ጃኬት" and "jacket" land on the same posts. */
export function expandKeywords(keywords) {
  const out = new Set();
  for (const k of keywords || []) {
    const key = String(k).toLowerCase().trim();
    if (!key) continue;
    out.add(key);
    for (const t of translationsOf(key)) out.add(String(t).toLowerCase().trim());
  }
  return [...out].slice(0, MAX_KEYWORDS * 2);
}

/** Which language to speak back to this lister. */
export function postLang(text) {
  const s = detectScript(text);
  return (s === 'ethiopic' || s === 'latin-am') ? 'am' : 'en';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapParse.test.mjs`
Expected: PASS, 7 tests.

If `postLang('ጃኬት እፈልጋለሁ')` returns `'en'`, read `detectScript`'s return values in `amharicScript.mjs` and map whichever tags it actually produces — do **not** weaken the test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/swap/swapParse.mjs apps/web/src/lib/server/__tests__/swapParse.test.mjs
git commit -m "swap: parse item and wants lines into searchable keywords"
```

---

### Task 4: The posting wizard

**Files:**
- Create: `apps/web/src/lib/server/swap/swapPost.mjs`
- Test: `apps/web/src/lib/server/__tests__/swapPost.test.mjs`

**Interfaces:**
- Consumes: `constants.mjs`, `swapAreas.mjs`, `swapParse.mjs`.
- Produces:
  - `STEPS = ['await_kind','await_title','await_wants','await_condition','await_area','await_area_text']`
  - `advanceDraft(draft, input): { draft, prompt, publish }` — **pure**. `input` is `{ kind:'text', value }` or `{ kind:'tap', value }` or `{ kind:'photo', fileId }`. `prompt` is `{ text, keyboard? }` or `null`. `publish` is `true` only on the final step.
  - `newDraft({ telegramUserId, chatId, fileId }): draft`
  - `draftPrompt(step, lang): { text, keyboard? }`
  - `publishDraft(sb, draft, { parse }): Promise<{ item }|{ refused: string }>`

A `draft` is `{ telegram_user_id, chat_id, step, payload }` where `payload` is `{ photo_file_ids, title, wants_text, condition, area, area_is_freetext, lang }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/__tests__/swapPost.test.mjs`:

```js
/**
 * The wizard is four questions, and every one of them is a place a first-time
 * lister can walk away. So the state machine is pure and tested directly:
 * no Telegram, no database, no LLM in these tests — just "given this draft and
 * this input, what is the next question".
 *
 * The photo-before-title branch is the whole multi-photo UI. There is no
 * upload screen; sending another picture while the bot is asking "what is it?"
 * attaches it. That behaviour has to survive refactors, hence the test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, advanceDraft, publishDraft } from '../swap/swapPost.mjs';
import { MAX_PHOTOS, MAX_TEXT } from '../swap/constants.mjs';

const start = () => newDraft({ telegramUserId: 7, chatId: 7, fileId: 'photo-1' });

test('a photo opens the draft asking what to do with it', () => {
  const d = start();
  assert.equal(d.step, 'await_kind');
  assert.deepEqual(d.payload.photo_file_ids, ['photo-1']);
});

test('tapping "swap it" asks for the description', () => {
  const { draft, prompt } = advanceDraft(start(), { kind: 'tap', value: 'swap' });
  assert.equal(draft.step, 'await_title');
  assert.match(prompt.text, /what is it/i);
});

test('extra photos sent before the title attach to the same draft', () => {
  let { draft } = advanceDraft(start(), { kind: 'tap', value: 'swap' });
  ({ draft } = advanceDraft(draft, { kind: 'photo', fileId: 'photo-2' }));
  assert.deepEqual(draft.payload.photo_file_ids, ['photo-1', 'photo-2']);
  assert.equal(draft.step, 'await_title', 'still waiting on the description');
});

test('photos stop attaching at the cap instead of growing forever', () => {
  let { draft } = advanceDraft(start(), { kind: 'tap', value: 'swap' });
  for (let i = 2; i < 10; i++) ({ draft } = advanceDraft(draft, { kind: 'photo', fileId: `p${i}` }));
  assert.equal(draft.payload.photo_file_ids.length, MAX_PHOTOS);
});

test('the full happy path reaches publish with every field set', () => {
  let d = start(), prompt;
  ({ draft: d } = advanceDraft(d, { kind: 'tap',  value: 'swap' }));
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'Redmi Note 10, small crack' }));
  assert.equal(d.step, 'await_wants');
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'winter jacket or a watch' }));
  assert.equal(d.step, 'await_condition');
  ({ draft: d, prompt } = advanceDraft(d, { kind: 'tap', value: 'good' }));
  assert.equal(d.step, 'await_area');
  assert.ok(prompt.keyboard.flat().some(b => b.callback_data === 'sw:area:other'));

  const done = advanceDraft(d, { kind: 'tap', value: 'bole' });
  assert.equal(done.publish, true);
  assert.deepEqual(
    { t: done.draft.payload.title, w: done.draft.payload.wants_text, c: done.draft.payload.condition, a: done.draft.payload.area },
    { t: 'Redmi Note 10, small crack', w: 'winter jacket or a watch', c: 'good', a: 'bole' },
  );
});

test('"somewhere else" asks for typed text instead of publishing', () => {
  let d = start();
  ({ draft: d } = advanceDraft(d, { kind: 'tap',  value: 'swap' }));
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'jacket' }));
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'phone' }));
  ({ draft: d } = advanceDraft(d, { kind: 'tap',  value: 'good' }));
  const r = advanceDraft(d, { kind: 'tap', value: 'other' });
  assert.equal(r.publish, undefined);
  assert.equal(r.draft.step, 'await_area_text');

  const done = advanceDraft(r.draft, { kind: 'text', value: 'Hawassa Piazza' });
  assert.equal(done.publish, true);
  assert.equal(done.draft.payload.area, 'Hawassa Piazza');
  assert.equal(done.draft.payload.area_is_freetext, true);
});

test('long text is truncated, not rejected — nobody retypes a post', () => {
  let d = start();
  ({ draft: d } = advanceDraft(d, { kind: 'tap', value: 'swap' }));
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'y'.repeat(500) }));
  assert.equal(d.payload.title.length, MAX_TEXT);
});

test('the wizard answers in Amharic when the lister writes Amharic', () => {
  let d = start();
  ({ draft: d } = advanceDraft(d, { kind: 'tap', value: 'swap' }));
  const { draft, prompt } = advanceDraft(d, { kind: 'text', value: 'ስልክ ሬድሚ' });
  assert.equal(draft.payload.lang, 'am');
  assert.ok(/[ሀ-፿]/.test(prompt.text), 'the next question is asked in Amharic');
});

/** Minimal Supabase fake: records the row handed to insert(). */
function fakeSb(sink) {
  return {
    from: () => ({
      insert: (row) => ({
        select: () => ({
          single: async () => { sink.push(row); return { data: { id: 'item-1', ...row }, error: null }; },
        }),
      }),
    }),
  };
}

test('publishing stores both keyword sets and an expiry date', async () => {
  const sink = [];
  const parse = async (text) => text.includes('jacket')
    ? { category: 'clothing_fashion', keywords: ['jacket'], banned: null }
    : { category: 'electronics_phones', keywords: ['phone'], banned: null };

  const draft = {
    telegram_user_id: 7, chat_id: 7, step: 'await_area',
    payload: {
      photo_file_ids: ['photo-1'], title: 'Redmi Note 10', wants_text: 'winter jacket',
      condition: 'good', area: 'bole', area_is_freetext: false, lang: 'en',
    },
  };
  const r = await publishDraft(fakeSb(sink), draft, { parse });
  assert.ok(r.item, 'published');
  const row = sink[0];
  assert.deepEqual(row.keywords, ['phone']);
  assert.deepEqual(row.want_keywords, ['jacket']);
  assert.equal(row.status, 'active');
  assert.ok(new Date(row.expires_at) > new Date(), 'expiry is in the future');
});

test('a banned item is refused and never reaches the database', async () => {
  const sink = [];
  const parse = async () => ({ category: null, keywords: [], banned: 'weapons' });
  const draft = {
    telegram_user_id: 7, chat_id: 7, step: 'await_area',
    payload: {
      photo_file_ids: ['photo-1'], title: 'AK47 mag', wants_text: 'phone',
      condition: 'good', area: 'bole', area_is_freetext: false, lang: 'en',
    },
  };
  const r = await publishDraft(fakeSb(sink), draft, { parse });
  assert.equal(r.refused, 'weapons');
  assert.equal(sink.length, 0, 'nothing was inserted');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapPost.test.mjs`
Expected: FAIL — `Cannot find module '../swap/swapPost.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/server/swap/swapPost.mjs`:

```js
/**
 * The posting wizard: photo in, live listing out, four questions between.
 *
 * `advanceDraft` is pure on purpose. Every branch here is a place a first-time
 * lister can abandon the flow, so the transitions are testable without a bot
 * token, a database, or a network — the I/O lives in the caller.
 */
import { MAX_PHOTOS, MAX_TEXT, CONDITIONS, CONDITION_LABELS, EXPIRY_DAYS } from './constants.mjs';
import { areaKeyboard, normalizeArea } from './swapAreas.mjs';
import { parseSwapText, expandKeywords, postLang } from './swapParse.mjs';

export const STEPS = ['await_kind', 'await_title', 'await_wants', 'await_condition', 'await_area', 'await_area_text'];

const T = {
  kind:      { en: 'What do you want to do with this?', am: 'በዚህ ምን ማድረግ ይፈልጋሉ?' },
  swapBtn:   { en: '🔄 Swap it', am: '🔄 ልቀይረው' },
  findBtn:   { en: '🔍 Find this', am: '🔍 ይህን ፈልግ' },
  title:     { en: 'What is it? (short — "Redmi Note 10, cracked back")', am: 'ምንድን ነው? (አጭር — "ሬድሚ ኖት 10, ጀርባው የተሰነጠቀ")' },
  wants:     { en: 'What do you want for it?', am: 'በምን መቀየር ይፈልጋሉ?' },
  condition: { en: 'Condition?', am: 'ሁኔታው?' },
  area:      { en: 'Where are you?', am: 'የት ነው ያሉት?' },
  areaText:  { en: 'Type your area:', am: 'አካባቢዎን ይጻፉ:' },
};

const t = (key, lang) => T[key][lang === 'am' ? 'am' : 'en'];

/** A photo has arrived and no draft was open. */
export function newDraft({ telegramUserId, chatId, fileId }) {
  return {
    telegram_user_id: telegramUserId,
    chat_id: chatId,
    step: 'await_kind',
    payload: {
      photo_file_ids: fileId ? [fileId] : [],
      title: '', wants_text: '', condition: '', area: '', area_is_freetext: false, lang: 'en',
    },
  };
}

/** The question to ask at a given step. */
export function draftPrompt(step, lang = 'en') {
  switch (step) {
    case 'await_kind':
      return { text: t('kind', lang), keyboard: [[
        { text: t('findBtn', lang), callback_data: 'sw:kind:find' },
        { text: t('swapBtn', lang), callback_data: 'sw:kind:swap' },
      ]] };
    case 'await_title': return { text: t('title', lang) };
    case 'await_wants': return { text: t('wants', lang) };
    case 'await_condition':
      return { text: t('condition', lang), keyboard: [CONDITIONS.map(c => ({
        text: CONDITION_LABELS[c][lang === 'am' ? 'am' : 'en'],
        callback_data: `sw:cond:${c}`,
      }))] };
    case 'await_area':      return { text: t('area', lang), keyboard: areaKeyboard(lang) };
    case 'await_area_text': return { text: t('areaText', lang) };
    default: return { text: t('title', lang) };
  }
}

const cap = (s) => String(s || '').trim().slice(0, MAX_TEXT);

/**
 * One transition. Returns the next draft, the next question, and whether the
 * caller should publish. Never mutates its argument.
 */
export function advanceDraft(draft, input) {
  const d = { ...draft, payload: { ...draft.payload, photo_file_ids: [...draft.payload.photo_file_ids] } };
  const lang = d.payload.lang;

  // A photo at any point before the description attaches to this draft. This
  // is the entire multi-photo UI — no upload screen, no "add photo" button.
  if (input.kind === 'photo') {
    if (d.payload.photo_file_ids.length < MAX_PHOTOS) d.payload.photo_file_ids.push(input.fileId);
    return { draft: d, prompt: null };
  }

  switch (d.step) {
    case 'await_kind':
      if (input.value === 'swap') {
        d.step = 'await_title';
        return { draft: d, prompt: draftPrompt(d.step, lang) };
      }
      return { draft: d, prompt: null };

    case 'await_title':
      d.payload.title = cap(input.value);
      d.payload.lang = postLang(input.value);
      d.step = 'await_wants';
      return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };

    case 'await_wants':
      d.payload.wants_text = cap(input.value);
      d.step = 'await_condition';
      return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };

    case 'await_condition':
      if (!CONDITIONS.includes(input.value)) return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };
      d.payload.condition = input.value;
      d.step = 'await_area';
      return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };

    case 'await_area': {
      if (input.value === 'other') {
        d.step = 'await_area_text';
        return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };
      }
      const { area, isFreetext } = normalizeArea(input.value);
      d.payload.area = area;
      d.payload.area_is_freetext = isFreetext;
      return { draft: d, prompt: null, publish: true };
    }

    case 'await_area_text': {
      const { area, isFreetext } = normalizeArea(input.value);
      d.payload.area = area;
      d.payload.area_is_freetext = isFreetext;
      return { draft: d, prompt: null, publish: true };
    }

    default:
      return { draft: d, prompt: null };
  }
}

/**
 * Turn a finished draft into a live row. Parses both lines — the item AND the
 * wants — because the wants line is what the reverse-index block searches.
 */
export async function publishDraft(sb, draft, { parse = parseSwapText } = {}) {
  const p = draft.payload;
  const [item, want] = await Promise.all([parse(p.title), parse(p.wants_text)]);
  if (item.banned) return { refused: item.banned };
  if (want.banned) return { refused: want.banned };

  const row = {
    telegram_user_id: draft.telegram_user_id,
    telegram_username: draft.telegram_username || null,
    title: p.title,
    wants_text: p.wants_text,
    condition: p.condition,
    area: p.area,
    area_is_freetext: p.area_is_freetext,
    photo_file_ids: p.photo_file_ids,
    category: item.category,
    keywords: expandKeywords(item.keywords),
    want_category: want.category,
    want_keywords: expandKeywords(want.keywords),
    lang: p.lang,
    status: 'active',
    expires_at: new Date(Date.now() + EXPIRY_DAYS * 86400000).toISOString(),
  };

  const { data, error } = await sb.from('swap_items').insert(row).select().single();
  if (error) return { refused: 'save_failed' };
  return { item: data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapPost.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/swap/swapPost.mjs apps/web/src/lib/server/__tests__/swapPost.test.mjs
git commit -m "swap: posting wizard state machine and publish"
```

---

### Task 5: Discovery — both blocks and the placement rules

**Files:**
- Create: `apps/web/src/lib/server/swap/swapSearch.mjs`
- Test: `apps/web/src/lib/server/__tests__/swapSearch.test.mjs`

**Interfaces:**
- Consumes: `constants.mjs`, `swapAreas.mjs`.
- Produces:
  - `isCommercialQuery(text: string): boolean`
  - `selectSwapCards({ haves, wants, searcherArea }): { haves: Row[], wants: Row[] }` — the two blocks, already capped at `MAX_SWAP_CARDS` **combined** and area-sorted.
  - `formatSwapBlocks({ haves, wants, query, lang }): { text: string, keyboard: Array } | null`
  - `swapEmptyLine(query: string, lang: 'en'|'am'): string`
  - `fetchSwapMatches(sb, { keywords, category, excludeUserId }): Promise<{ haves: Row[], wants: Row[] }>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/__tests__/swapSearch.test.mjs`:

```js
/**
 * Two rules in here are commercial, not cosmetic: swaps are capped at three
 * cards and never rank above the businesses that pay for the platform. A
 * refactor that "improves" swap visibility by relaxing either one is a
 * regression against the business model, so both are asserted directly.
 *
 * The reverse block (people who WANT what you searched) is the other load
 * bearing piece — it is what makes a thin pool feel liquid, and it comes
 * free from the same query.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCommercialQuery, selectSwapCards, formatSwapBlocks, swapEmptyLine } from '../swap/swapSearch.mjs';
import { MAX_SWAP_CARDS } from '../swap/constants.mjs';

const item = (over = {}) => ({
  id: 'i1', title: 'Redmi Note 10', wants_text: 'winter jacket', condition: 'good',
  area: 'bole', photo_file_ids: ['f1'], created_at: new Date().toISOString(), ...over,
});

test('commercial queries suppress swaps entirely', () => {
  for (const q of ['phone delivery', 'wholesale jackets', 'shop for shoes', 'phone supplier']) {
    assert.equal(isCommercialQuery(q), true, q);
  }
  for (const q of ['phone', 'winter jacket', 'ጃኬት']) {
    assert.equal(isCommercialQuery(q), false, q);
  }
});

test('the two blocks together never exceed the card cap', () => {
  const haves = Array.from({ length: 5 }, (_, i) => item({ id: `h${i}` }));
  const wants = Array.from({ length: 5 }, (_, i) => item({ id: `w${i}` }));
  const sel = selectSwapCards({ haves, wants, searcherArea: null });
  assert.equal(sel.haves.length + sel.wants.length, MAX_SWAP_CARDS);
});

test('haves are filled before wants — the thing you searched for comes first', () => {
  const haves = Array.from({ length: 5 }, (_, i) => item({ id: `h${i}` }));
  const wants = Array.from({ length: 5 }, (_, i) => item({ id: `w${i}` }));
  const sel = selectSwapCards({ haves, wants, searcherArea: null });
  assert.ok(sel.haves.length >= sel.wants.length);
});

test('a want block still shows when there are no haves at all', () => {
  const wants = [item({ id: 'w1' })];
  const sel = selectSwapCards({ haves: [], wants, searcherArea: null });
  assert.equal(sel.haves.length, 0);
  assert.equal(sel.wants.length, 1);
});

test('same-area posts sort ahead of far ones', () => {
  const haves = [item({ id: 'far', area: 'ayat' }), item({ id: 'near', area: 'bole' })];
  const sel = selectSwapCards({ haves, wants: [], searcherArea: 'bole' });
  assert.equal(sel.haves[0].id, 'near');
});

test('newer posts sort ahead when area does not decide it', () => {
  const old = item({ id: 'old', created_at: new Date(Date.now() - 10 * 86400000).toISOString() });
  const fresh = item({ id: 'fresh', created_at: new Date().toISOString() });
  const sel = selectSwapCards({ haves: [old, fresh], wants: [], searcherArea: null });
  assert.equal(sel.haves[0].id, 'fresh');
});

test('every card leads with what the owner wants — in barter that is the price', () => {
  const out = formatSwapBlocks({ haves: [item()], wants: [], query: 'phone', lang: 'en' });
  const linesAfterTitle = out.text.split('\n').filter(Boolean);
  const titleIdx = linesAfterTitle.findIndex(l => l.includes('Redmi Note 10'));
  assert.ok(linesAfterTitle[titleIdx + 1].includes('Wants:'), out.text);
});

test('each card carries an interest button addressed to its own item', () => {
  const out = formatSwapBlocks({ haves: [item({ id: 'abc' })], wants: [], query: 'phone', lang: 'en' });
  assert.ok(out.keyboard.flat().some(b => b.callback_data === 'sw:want:abc'));
});

test('the reverse block is labelled as people who WANT the query', () => {
  const out = formatSwapBlocks({ haves: [], wants: [item({ id: 'w1' })], query: 'phone', lang: 'en' });
  assert.match(out.text, /WANT a phone|want a phone/i);
});

test('nothing to show returns null so the caller appends nothing', () => {
  assert.equal(formatSwapBlocks({ haves: [], wants: [], query: 'phone', lang: 'en' }), null);
});

test('the empty state recruits supply for the exact thing searched', () => {
  const line = swapEmptyLine('winter jacket', 'en');
  assert.match(line, /winter jacket/);
  assert.match(line, /photo/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapSearch.test.mjs`
Expected: FAIL — `Cannot find module '../swap/swapSearch.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/server/swap/swapSearch.mjs`:

```js
/**
 * Swap discovery, appended under the business results.
 *
 * Two blocks come out of one query. The first matches the searcher's words
 * against what people HAVE. The second matches the same words against what
 * people WANT — the reverse index, which costs nothing extra and roughly
 * doubles the chance a thin pool produces a hit.
 *
 * The caps here are commercial. Businesses pay for MiniMe; swaps are the
 * funnel that feeds it. Three cards, always below the shops, never on a query
 * that reads like someone ready to buy.
 */
import { MAX_SWAP_CARDS } from './constants.mjs';
import { areaLabel } from './swapAreas.mjs';

/** Words that mean "I am shopping", where a barter card is noise at best. */
const COMMERCIAL = [
  'delivery', 'deliver', 'wholesale', 'shop', 'shops', 'store', 'supplier',
  'suppliers', 'bulk', 'invoice', 'warranty', 'ማድረስ', 'ጅምላ', 'ሱቅ',
];

export function isCommercialQuery(text) {
  const t = String(text || '').toLowerCase();
  return COMMERCIAL.some(w => t.includes(w));
}

const freshness = (r) => new Date(r.created_at || 0).getTime();

function sortForSearcher(rows, searcherArea) {
  return [...rows].sort((a, b) => {
    if (searcherArea) {
      const an = a.area === searcherArea ? 0 : 1;
      const bn = b.area === searcherArea ? 0 : 1;
      if (an !== bn) return an - bn;
    }
    return freshness(b) - freshness(a);
  });
}

/**
 * Choose which cards to show. Haves fill first — someone searching "phone"
 * most wants a phone — and wants take whatever room is left, so the reverse
 * block never crowds out the direct answer.
 */
export function selectSwapCards({ haves = [], wants = [], searcherArea = null }) {
  const h = sortForSearcher(haves, searcherArea);
  const w = sortForSearcher(wants, searcherArea);
  const takeHaves = Math.min(h.length, h.length >= MAX_SWAP_CARDS && w.length ? MAX_SWAP_CARDS - 1 : MAX_SWAP_CARDS);
  const chosenHaves = h.slice(0, takeHaves);
  const chosenWants = w.slice(0, Math.max(0, MAX_SWAP_CARDS - chosenHaves.length));
  return { haves: chosenHaves, wants: chosenWants };
}

const L = {
  havesHeader: { en: '🔄 *Swaps from people*', am: '🔄 *ከሰዎች የሚቀየሩ*' },
  wantsHeader: { en: '🙋 *People who WANT', am: '🙋 *የሚፈልጉ ሰዎች —' },
  wants:       { en: 'Wants:', am: 'ይፈልጋል:' },
  offering:    { en: 'offering:', am: 'ያቀርባል:' },
  button:      { en: "🔄 I'll swap for this", am: '🔄 እቀይራለሁ' },
  empty:       { en: (q) => `Nobody's swapping ${q} yet. Have one to trade? Just send me a photo.`,
                 am: (q) => `${q} የሚቀይር ሰው የለም። አለዎት? ፎቶ ይላኩልኝ።` },
};

const pick = (k, lang) => L[k][lang === 'am' ? 'am' : 'en'];

const ago = (iso) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
};

/**
 * Render both blocks as one Markdown chunk plus one keyboard. Returns null
 * when there is nothing to append — the caller must not print an empty header.
 */
export function formatSwapBlocks({ haves = [], wants = [], query, lang = 'en' }) {
  if (!haves.length && !wants.length) return null;
  const lines = [];
  const keyboard = [];

  if (haves.length) {
    lines.push('', pick('havesHeader', lang));
    for (const r of haves) {
      lines.push(`📷 *${r.title}*`);
      lines.push(`${pick('wants', lang)} ${r.wants_text}`);
      lines.push(`${areaLabel(r.area, lang)} · ${ago(r.created_at)}`);
      lines.push('');
      keyboard.push([{ text: `${pick('button', lang)} — ${r.title}`.slice(0, 64), callback_data: `sw:want:${r.id}` }]);
    }
  }

  if (wants.length) {
    lines.push('', `${pick('wantsHeader', lang)} ${query}*`);
    for (const r of wants) {
      lines.push(`🙋 wants *${r.wants_text}* — ${pick('offering', lang)} ${r.title}`);
      lines.push(`${areaLabel(r.area, lang)} · ${ago(r.created_at)}`);
      lines.push('');
      keyboard.push([{ text: `${pick('button', lang)} — ${r.title}`.slice(0, 64), callback_data: `sw:want:${r.id}` }]);
    }
  }

  return { text: lines.join('\n').trim(), keyboard };
}

/** Shown when a search found no swaps: the gap advertises itself. */
export function swapEmptyLine(query, lang = 'en') {
  return pick('empty', lang)(query);
}

/**
 * Pull both candidate sets in one round trip each. The searcher's own posts
 * are excluded — being shown your own jacket back is the fastest way to look
 * broken.
 */
export async function fetchSwapMatches(sb, { keywords = [], category = null, excludeUserId = null } = {}) {
  if (!keywords.length && !category) return { haves: [], wants: [] };
  const cols = 'id, title, wants_text, condition, area, photo_file_ids, created_at, telegram_user_id';
  const nowIso = new Date().toISOString();

  const base = (col, cat) => {
    let q = sb.from('swap_items').select(cols).eq('status', 'active').gt('expires_at', nowIso);
    if (keywords.length) q = q.overlaps(col, keywords);
    else q = q.eq(cat, category);
    if (excludeUserId) q = q.neq('telegram_user_id', excludeUserId);
    return q.limit(20);
  };

  const [h, w] = await Promise.all([
    base('keywords', 'category'),
    base('want_keywords', 'want_category'),
  ]);

  return { haves: h.data || [], wants: w.data || [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapSearch.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/swap/swapSearch.mjs apps/web/src/lib/server/__tests__/swapSearch.test.mjs
git commit -m "swap: discovery blocks with capped, business-first placement"
```

---

### Task 6: Interest, reveal and reports

**Files:**
- Create: `apps/web/src/lib/server/swap/swapInterest.mjs`
- Test: `apps/web/src/lib/server/__tests__/swapInterest.test.mjs`

**Interfaces:**
- Consumes: `constants.mjs`.
- Produces:
  - `revealText({ item, offerText, fromUsername, lang }): { toSeeker: string, toLister: string }`
  - `recordInterest(sb, { itemId, fromUserId, fromUsername, offerText }): Promise<{ ok: true, item }|{ error: string }>` — errors: `'not_found'`, `'no_username'`, `'own_item'`, `'duplicate'`
  - `recordReport(sb, { itemId, reporterUserId, reportedUserId, reason }): Promise<{ hidden: boolean, count: number }>`

The daily reveal cap uses the existing `rateLimitPersistent(identifier, bucket, max, windowSecs)` from `../rateLimit.js` and is applied by the **caller** in Task 8, not here — `rateLimit.js` reaches for the database on import, which would break `node --test`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/__tests__/swapInterest.test.mjs`:

```js
/**
 * Handles are revealed automatically — that was a product decision, and it
 * means MiniMe sees nothing after the handoff. Everything here exists to make
 * that handoff survivable: an offer line so a tap costs a sentence, a
 * simultaneous heads-up so no DM arrives cold, and a report path that still
 * works after the two of them have left for Telegram DMs.
 *
 * The no-username case is not an edge case. A Telegram account without an
 * @handle cannot be messaged at all, so revealing one produces a dead end that
 * looks like a bug to both people.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealText, recordInterest, recordReport } from '../swap/swapInterest.mjs';
import { REPORTS_TO_HIDE } from '../swap/constants.mjs';

const ITEM = {
  id: 'i1', title: 'Redmi Note 10', wants_text: 'winter jacket',
  telegram_user_id: 42, telegram_username: 'meron_x', chat_id: 42, lang: 'en',
};

/**
 * Supabase fake covering just the shapes this module uses:
 * select().eq().maybeSingle(), insert(), and select(count).eq().
 */
function fakeSb({ item = ITEM, interests = [], reports = [] } = {}) {
  const state = { interests: [...interests], reports: [...reports] };
  return {
    state,
    from(table) {
      if (table === 'swap_items') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: item, error: null }) }) }),
          update: (patch) => ({ eq: async () => { Object.assign(state, { patch }); return { error: null }; } }),
        };
      }
      if (table === 'swap_interests') {
        return {
          insert: async (row) => {
            const dupe = state.interests.some(i =>
              i.swap_item_id === row.swap_item_id && i.from_telegram_user_id === row.from_telegram_user_id);
            if (dupe) return { error: { code: '23505', message: 'duplicate key' } };
            state.interests.push(row);
            return { error: null };
          },
        };
      }
      if (table === 'swap_reports') {
        return {
          insert: async (row) => { state.reports.push(row); return { error: null }; },
          select: () => ({ eq: async () => ({ count: state.reports.length, error: null }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('the seeker gets the handle and the lister is told at the same moment', () => {
  const { toSeeker, toLister } = revealText({
    item: ITEM, offerText: 'Nikon D3100, works fine', fromUsername: 'dawit_t', lang: 'en',
  });
  assert.match(toSeeker, /@meron_x/);
  assert.match(toLister, /@dawit_t/);
  assert.match(toLister, /Nikon D3100/, 'the lister sees what is being offered, not just that someone tapped');
  assert.match(toLister, /Redmi Note 10/);
});

test('an interest is recorded with its offer line', async () => {
  const sb = fakeSb();
  const r = await recordInterest(sb, { itemId: 'i1', fromUserId: 7, fromUsername: 'dawit_t', offerText: 'Nikon D3100' });
  assert.equal(r.ok, true);
  assert.equal(sb.state.interests[0].offer_text, 'Nikon D3100');
});

test('you cannot express interest in your own post', async () => {
  const sb = fakeSb();
  const r = await recordInterest(sb, { itemId: 'i1', fromUserId: 42, fromUsername: 'meron_x', offerText: 'x' });
  assert.equal(r.error, 'own_item');
  assert.equal(sb.state.interests.length, 0);
});

test('a lister with no @username is never revealed', async () => {
  const sb = fakeSb({ item: { ...ITEM, telegram_username: null } });
  const r = await recordInterest(sb, { itemId: 'i1', fromUserId: 7, fromUsername: 'dawit_t', offerText: 'x' });
  assert.equal(r.error, 'no_username');
});

test('tapping the same item twice is not counted twice', async () => {
  const sb = fakeSb();
  await recordInterest(sb, { itemId: 'i1', fromUserId: 7, fromUsername: 'd', offerText: 'x' });
  const again = await recordInterest(sb, { itemId: 'i1', fromUserId: 7, fromUsername: 'd', offerText: 'y' });
  assert.equal(again.error, 'duplicate');
  assert.equal(sb.state.interests.length, 1);
});

test('a missing or expired item fails closed', async () => {
  const sb = fakeSb({ item: null });
  const r = await recordInterest(sb, { itemId: 'gone', fromUserId: 7, fromUsername: 'd', offerText: 'x' });
  assert.equal(r.error, 'not_found');
});

test('reports below the threshold record but do not hide', async () => {
  const sb = fakeSb();
  const r = await recordReport(sb, { itemId: 'i1', reporterUserId: 9, reportedUserId: 42, reason: 'scam' });
  assert.equal(r.hidden, false);
  assert.equal(r.count, 1);
});

test('the threshold report hides the post', async () => {
  const existing = Array.from({ length: REPORTS_TO_HIDE - 1 }, (_, i) => ({ reporter_telegram_user_id: i }));
  const sb = fakeSb({ reports: existing });
  const r = await recordReport(sb, { itemId: 'i1', reporterUserId: 99, reportedUserId: 42, reason: 'scam' });
  assert.equal(r.count, REPORTS_TO_HIDE);
  assert.equal(r.hidden, true);
  assert.equal(sb.state.patch.status, 'hidden');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapInterest.test.mjs`
Expected: FAIL — `Cannot find module '../swap/swapInterest.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/server/swap/swapInterest.mjs`:

```js
/**
 * The handshake: one tap, one sentence, two @handles.
 *
 * Handles are revealed without the lister approving anything — but a tap costs
 * an offer line first. That line does two jobs: it filters out drive-by taps,
 * and it turns the lister's notification from an alarm ("someone has your
 * handle") into information ("someone is offering a Nikon").
 *
 * After the reveal MiniMe is out of the loop, so `recordReport` is the only
 * lever left. Three distinct reporters hide the post.
 */
import { REPORTS_TO_HIDE } from './constants.mjs';

const M = {
  en: {
    seeker: (u, title) => `${u} — message them and offer your swap.\n\nSay what you're offering in your first message.`,
    lister: (u, title, offer) => `👀 @${u} is interested in your *${title}* — offering: _${offer}_.\n\nThey may message you.`,
  },
  am: {
    seeker: (u, title) => `${u} — መልእክት ይላኩላቸው።\n\nበመጀመሪያ መልእክትዎ የሚያቀርቡትን ይግለጹ።`,
    lister: (u, title, offer) => `👀 @${u} *${title}* ላይ ፍላጎት አለው — ያቀርባል: _${offer}_።\n\nመልእክት ሊልክልዎ ይችላል።`,
  },
};

/** The two halves of the reveal, sent to the two people at the same moment. */
export function revealText({ item, offerText, fromUsername, lang = 'en' }) {
  const m = M[lang === 'am' ? 'am' : 'en'];
  return {
    toSeeker: m.seeker(`@${item.telegram_username}`, item.title),
    toLister: m.lister(fromUsername, item.title, offerText),
  };
}

/**
 * Record one person's interest in one item. Returns the item on success so the
 * caller can render the reveal without a second read.
 */
export async function recordInterest(sb, { itemId, fromUserId, fromUsername, offerText }) {
  const { data: item } = await sb.from('swap_items')
    .select('id, title, wants_text, telegram_user_id, telegram_username, lang, status')
    .eq('id', itemId).maybeSingle();

  if (!item || item.status !== 'active') return { error: 'not_found' };
  if (String(item.telegram_user_id) === String(fromUserId)) return { error: 'own_item' };
  // No @handle means no reachable person. Revealing one is a dead end that
  // reads as a bug to both sides, so refuse before anything is written.
  if (!item.telegram_username) return { error: 'no_username' };

  const { error } = await sb.from('swap_interests').insert({
    swap_item_id: itemId,
    from_telegram_user_id: fromUserId,
    from_telegram_username: fromUsername || null,
    offer_text: String(offerText || '').slice(0, 200),
  });
  if (error) return { error: error.code === '23505' ? 'duplicate' : 'save_failed' };

  return { ok: true, item };
}

/** Record a report; hide the post once enough distinct people have filed one. */
export async function recordReport(sb, { itemId, reporterUserId, reportedUserId, reason }) {
  await sb.from('swap_reports').insert({
    swap_item_id: itemId,
    reporter_telegram_user_id: reporterUserId,
    reported_telegram_user_id: reportedUserId,
    reason: reason ? String(reason).slice(0, 200) : null,
  });

  const { count } = await sb.from('swap_reports')
    .select('id', { count: 'exact', head: true })
    .eq('swap_item_id', itemId);

  const total = count || 0;
  if (total >= REPORTS_TO_HIDE) {
    await sb.from('swap_items').update({ status: 'hidden' }).eq('id', itemId);
    return { hidden: true, count: total };
  }
  return { hidden: false, count: total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapInterest.test.mjs`
Expected: PASS, 8 tests.

If the count assertion fails because the fake ignores the `{ count: 'exact', head: true }` argument shape, fix the **fake** to match how `swapInterest.mjs` calls it — not the module.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/swap/swapInterest.mjs apps/web/src/lib/server/__tests__/swapInterest.test.mjs
git commit -m "swap: offer-gated handle reveal with reports"
```

---

### Task 7: Lifecycle and the cron job

**Files:**
- Create: `apps/web/src/lib/server/swap/swapLifecycle.mjs`
- Create: `apps/web/src/app/api/cron/swap-lifecycle/route.js`
- Test: `apps/web/src/lib/server/__tests__/swapLifecycle.test.mjs`

**Interfaces:**
- Consumes: `constants.mjs`.
- Produces:
  - `expiryPrompt(item, lang): { text, keyboard }`
  - `completionPrompt(item, lang): { text, keyboard }`
  - `runSwapLifecycle(sb, { send, now }): Promise<{ expiryAsked: number, completionAsked: number, expired: number }>` where `send({ chatId, text, keyboard })` is injected.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/__tests__/swapLifecycle.test.mjs`:

```js
/**
 * Dead listings are what make a used-goods board feel abandoned, and nobody is
 * going to moderate this by hand. So the board prunes itself: ask once before
 * expiring, ask once about completion, then go quiet.
 *
 * "Once" is the load-bearing word in both cases. A bot that re-asks every day
 * whether you sold your phone gets muted, and a muted bot cannot run the rest
 * of this feature either.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSwapLifecycle, expiryPrompt, completionPrompt } from '../swap/swapLifecycle.mjs';

const DAY = 86400000;
const NOW = new Date('2026-09-02T06:00:00Z').getTime();

/**
 * Fake holding one table of rows, supporting the filter chain the module uses
 * and recording updates.
 */
function fakeSb(rows) {
  const updates = [];
  const makeQuery = (filters = []) => {
    const q = {
      select: () => q,
      eq: (col, val) => makeQuery([...filters, r => String(r[col]) === String(val)]),
      lte: (col, val) => makeQuery([...filters, r => r[col] && new Date(r[col]) <= new Date(val)]),
      lt: (col, val) => makeQuery([...filters, r => r[col] && new Date(r[col]) < new Date(val)]),
      is: (col, val) => makeQuery([...filters, r => (r[col] ?? null) === val]),
      not: (col, _op, val) => makeQuery([...filters, r => (r[col] ?? null) !== val]),
      limit: () => q,
      then: (resolve) => resolve({ data: rows.filter(r => filters.every(f => f(r))), error: null }),
    };
    return q;
  };
  return {
    updates,
    from: () => ({
      select: () => makeQuery(),
      update: (patch) => ({ eq: async (_c, id) => { updates.push({ id, patch }); return { error: null }; } }),
    }),
  };
}

const base = {
  id: 'i1', title: 'Redmi Note 10', telegram_user_id: 42, chat_id: 42, lang: 'en',
  status: 'active', first_reveal_at: null, completion_asked_at: null, expiry_asked_at: null,
  expires_at: new Date(NOW + 10 * DAY).toISOString(),
};

test('an item near expiry is asked once, and marked as asked', async () => {
  const rows = [{ ...base, expires_at: new Date(NOW + 3600_000).toISOString() }];
  const sent = [];
  const sb = fakeSb(rows);
  const r = await runSwapLifecycle(sb, { send: async (m) => sent.push(m), now: NOW });

  assert.equal(r.expiryAsked, 1);
  assert.match(sent[0].text, /Still have/i);
  assert.ok(sent[0].keyboard.flat().some(b => b.callback_data === 'sw:keep:i1'));
  assert.ok(sent[0].keyboard.flat().some(b => b.callback_data === 'sw:gone:i1'));
  assert.ok(sb.updates.some(u => u.patch.expiry_asked_at));
});

test('an item already asked about expiry is not asked again', async () => {
  const rows = [{
    ...base,
    expires_at: new Date(NOW + 3600_000).toISOString(),
    expiry_asked_at: new Date(NOW - DAY).toISOString(),
  }];
  const sent = [];
  const r = await runSwapLifecycle(fakeSb(rows), { send: async (m) => sent.push(m), now: NOW });
  assert.equal(r.expiryAsked, 0);
  assert.equal(sent.length, 0);
});

test('three days after the first reveal, the lister is asked if it happened', async () => {
  const rows = [{ ...base, first_reveal_at: new Date(NOW - 4 * DAY).toISOString() }];
  const sent = [];
  const r = await runSwapLifecycle(fakeSb(rows), { send: async (m) => sent.push(m), now: NOW });
  assert.equal(r.completionAsked, 1);
  assert.match(sent[0].text, /Did you swap/i);
  assert.ok(sent[0].keyboard.flat().some(b => b.callback_data === 'sw:done:i1'));
});

test('a reveal from yesterday is too fresh to ask about', async () => {
  const rows = [{ ...base, first_reveal_at: new Date(NOW - DAY).toISOString() }];
  const sent = [];
  const r = await runSwapLifecycle(fakeSb(rows), { send: async (m) => sent.push(m), now: NOW });
  assert.equal(r.completionAsked, 0);
});

test('the completion question is asked exactly once, ever', async () => {
  const rows = [{
    ...base,
    first_reveal_at: new Date(NOW - 9 * DAY).toISOString(),
    completion_asked_at: new Date(NOW - 5 * DAY).toISOString(),
  }];
  const sent = [];
  const r = await runSwapLifecycle(fakeSb(rows), { send: async (m) => sent.push(m), now: NOW });
  assert.equal(r.completionAsked, 0);
  assert.equal(sent.length, 0);
});

test('a send failure does not stop the rest of the batch', async () => {
  const rows = [
    { ...base, id: 'a', expires_at: new Date(NOW + 3600_000).toISOString() },
    { ...base, id: 'b', expires_at: new Date(NOW + 3600_000).toISOString() },
  ];
  let n = 0;
  const send = async () => { if (n++ === 0) throw new Error('blocked by user'); };
  const r = await runSwapLifecycle(fakeSb(rows), { send, now: NOW });
  assert.equal(r.expiryAsked, 1, 'the second item was still processed');
});

test('prompts name the item so a lister with several posts knows which one', () => {
  const p = expiryPrompt({ id: 'i1', title: 'Redmi Note 10' }, 'en');
  assert.match(p.text, /Redmi Note 10/);
  const c = completionPrompt({ id: 'i1', title: 'Redmi Note 10' }, 'en');
  assert.match(c.text, /Redmi Note 10/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapLifecycle.test.mjs`
Expected: FAIL — `Cannot find module '../swap/swapLifecycle.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/server/swap/swapLifecycle.mjs`:

```js
/**
 * The board prunes itself.
 *
 * Two questions, each asked at most once per item: "do you still have it"
 * before a post ages out, and "did you swap it" three days after the first
 * person got the lister's handle. Silence is a valid answer to both — the post
 * simply goes dark. Nobody moderates this by hand.
 *
 * `send` is injected so the whole job is testable without a bot token.
 */
import { COMPLETION_DELAY_DAYS } from './constants.mjs';

const DAY = 86400000;

const P = {
  en: {
    expiry: (t) => `Still have the *${t}*?`,
    keep: '✅ Yes, keep it live', gone: '❌ Gone',
    completion: (t) => `Did you swap the *${t}*?`,
    done: '🎉 Yes', notYet: 'Not yet',
  },
  am: {
    expiry: (t) => `*${t}* አሁንም አለዎት?`,
    keep: '✅ አዎ፣ ይቀጥል', gone: '❌ የለም',
    completion: (t) => `*${t}* ተቀይሯል?`,
    done: '🎉 አዎ', notYet: 'ገና',
  },
};

const lang_ = (l) => P[l === 'am' ? 'am' : 'en'];

export function expiryPrompt(item, lang = 'en') {
  const m = lang_(lang);
  return {
    text: m.expiry(item.title),
    keyboard: [[
      { text: m.keep, callback_data: `sw:keep:${item.id}` },
      { text: m.gone, callback_data: `sw:gone:${item.id}` },
    ]],
  };
}

export function completionPrompt(item, lang = 'en') {
  const m = lang_(lang);
  return {
    text: m.completion(item.title),
    keyboard: [[
      { text: m.done,   callback_data: `sw:done:${item.id}` },
      { text: m.notYet, callback_data: `sw:notyet:${item.id}` },
    ]],
  };
}

const COLS = 'id, title, telegram_user_id, chat_id, lang, status, first_reveal_at, completion_asked_at, expiry_asked_at, expires_at';

/**
 * One pass. Returns counts rather than throwing on a per-item failure: a
 * lister who blocked the bot must not stop the other hundred prompts.
 */
export async function runSwapLifecycle(sb, { send, now = Date.now() } = {}) {
  const nowIso = new Date(now).toISOString();
  let expiryAsked = 0, completionAsked = 0, expired = 0;

  // ── Ask before expiring ───────────────────────────────────────────────────
  const { data: expiring } = await sb.from('swap_items').select(COLS)
    .eq('status', 'active')
    .lte('expires_at', new Date(now + 2 * DAY).toISOString())
    .is('expiry_asked_at', null)
    .limit(200);

  for (const item of expiring || []) {
    try {
      const p = expiryPrompt(item, item.lang);
      await send({ chatId: item.chat_id || item.telegram_user_id, text: p.text, keyboard: p.keyboard });
      await sb.from('swap_items').update({ expiry_asked_at: nowIso }).eq('id', item.id);
      expiryAsked++;
    } catch (e) {
      console.warn('[swap] expiry prompt failed:', item.id, e.message);
    }
  }

  // ── Ask whether the swap happened ─────────────────────────────────────────
  const { data: revealed } = await sb.from('swap_items').select(COLS)
    .eq('status', 'active')
    .lt('first_reveal_at', new Date(now - COMPLETION_DELAY_DAYS * DAY).toISOString())
    .is('completion_asked_at', null)
    .limit(200);

  for (const item of revealed || []) {
    try {
      const p = completionPrompt(item, item.lang);
      await send({ chatId: item.chat_id || item.telegram_user_id, text: p.text, keyboard: p.keyboard });
      await sb.from('swap_items').update({ completion_asked_at: nowIso }).eq('id', item.id);
      completionAsked++;
    } catch (e) {
      console.warn('[swap] completion prompt failed:', item.id, e.message);
    }
  }

  // ── Retire what is past due and unanswered ────────────────────────────────
  const { data: dead } = await sb.from('swap_items').select('id')
    .eq('status', 'active').lte('expires_at', nowIso).limit(500);

  for (const item of dead || []) {
    await sb.from('swap_items').update({ status: 'expired' }).eq('id', item.id);
    expired++;
  }

  return { expiryAsked, completionAsked, expired };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapLifecycle.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the cron route**

Create `apps/web/src/app/api/cron/swap-lifecycle/route.js`:

```js
/**
 * GET /api/cron/swap-lifecycle
 *
 * Daily. Asks listers whether they still have an item before its post ages
 * out, asks whether a swap happened three days after the first handle reveal,
 * and retires posts that answered neither.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { runSwapLifecycle } from '../../../../lib/server/swap/swapLifecycle.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = process.env.SEARCH_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: true, skipped: 'no SEARCH_BOT_TOKEN' });

  const send = async ({ chatId, text, keyboard }) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: 'Markdown',
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      }),
    });
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.description || 'send failed');
  };

  const result = await runSwapLifecycle(supabase(), { send });
  return NextResponse.json({ ok: true, ...result });
}
```

Then register the schedule. Check whether the repo has a `vercel.json` with a `crons` array — if it does, add `{ "path": "/api/cron/swap-lifecycle", "schedule": "0 7 * * *" }`; if crons are registered elsewhere (an external scheduler), follow whatever `api/cron/reminders` does and match it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/swap/swapLifecycle.mjs \
        apps/web/src/lib/server/__tests__/swapLifecycle.test.mjs \
        apps/web/src/app/api/cron/swap-lifecycle/route.js
git commit -m "swap: self-pruning lifecycle with daily cron"
```

---

### Task 8: Wire it into the search bot

**Files:**
- Create: `apps/web/src/lib/server/swap/swapBotBridge.mjs`
- Modify: `apps/web/src/lib/server/searchBot.js` (4 sites; line numbers below are pre-edit)
- Test: `apps/web/src/lib/server/__tests__/swapBotBridge.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces:
  - `parseSwapCallback(data: string): { action: string, arg: string } | null` — `'sw:want:abc'` → `{ action: 'want', arg: 'abc' }`; anything not starting `sw:` → `null`
  - `handleSwapPhoto({ sb, tg, token, msg }): Promise<void>`
  - `handleSwapDraftText({ sb, tg, token, msg }): Promise<boolean>` — `true` if it consumed the message (so search must not run)
  - `handleSwapCallback({ sb, tg, token, cq }): Promise<boolean>`
  - `appendSwapBlocks({ sb, tg, token, chatId, senderId, query, parsed, lang }): Promise<void>`

This task is where the DB-backed draft store lives (`loadDraft` / `saveDraft` / `clearDraft`), because that is the only place it is used.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/server/__tests__/swapBotBridge.test.mjs`:

```js
/**
 * The bridge is the only place swap logic meets the search bot, so the one
 * thing tested here in isolation is the callback router. Everything else in
 * this module is I/O glue over units already covered by their own tests.
 *
 * `sw:` vs `sb:` matters: the search bot's existing callbacks all start `sb:`,
 * and a router that swallowed those would silently break search pagination,
 * ratings and feedback — failures nobody would attribute to the swap feature.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSwapCallback } from '../swap/swapBotBridge.mjs';

test('swap callbacks parse into an action and its argument', () => {
  assert.deepEqual(parseSwapCallback('sw:want:abc-123'), { action: 'want', arg: 'abc-123' });
  assert.deepEqual(parseSwapCallback('sw:kind:swap'),    { action: 'kind', arg: 'swap' });
  assert.deepEqual(parseSwapCallback('sw:area:other'),   { action: 'area', arg: 'other' });
  assert.deepEqual(parseSwapCallback('sw:done:i1'),      { action: 'done', arg: 'i1' });
});

test('existing search callbacks are left alone', () => {
  for (const d of ['sb:more:123:0', 'sb:fb:up:9', 'sb:grid:1:0']) {
    assert.equal(parseSwapCallback(d), null, d);
  }
});

test('junk data does not throw', () => {
  for (const d of [null, undefined, '', 'sw', 'sw:', 'nonsense']) {
    assert.doesNotThrow(() => parseSwapCallback(d));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapBotBridge.test.mjs`
Expected: FAIL — `Cannot find module '../swap/swapBotBridge.mjs'`

- [ ] **Step 3: Write the bridge**

Create `apps/web/src/lib/server/swap/swapBotBridge.mjs`:

```js
/**
 * Everything the search bot needs to know about swaps, in one module.
 *
 * searchBot.js is already 1800+ lines. It gets four call-outs to this file and
 * no swap logic of its own, so the feature can be read, tested and removed as
 * a unit.
 */
import { newDraft, advanceDraft, draftPrompt, publishDraft } from './swapPost.mjs';
import { fetchSwapMatches, selectSwapCards, formatSwapBlocks, swapEmptyLine, isCommercialQuery } from './swapSearch.mjs';
import { recordInterest, recordReport, revealText } from './swapInterest.mjs';
import { postLang } from './swapParse.mjs';
import { DRAFT_TTL_MINUTES, REVEALS_PER_DAY } from './constants.mjs';

/** `sw:want:abc` → { action: 'want', arg: 'abc' }. Leaves `sb:` callbacks alone. */
export function parseSwapCallback(data) {
  const s = String(data || '');
  if (!s.startsWith('sw:')) return null;
  const [, action, ...rest] = s.split(':');
  if (!action) return null;
  return { action, arg: rest.join(':') };
}

// ── Draft store ─────────────────────────────────────────────────────────────
// In Postgres, not a Map: on Vercel the instance that answered step 1 is not
// guaranteed to answer step 2, and a lost half-finished post is a lister who
// does not come back.

export async function loadDraft(sb, userId) {
  const { data } = await sb.from('swap_drafts').select('*').eq('telegram_user_id', userId).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.updated_at).getTime() > DRAFT_TTL_MINUTES * 60000) {
    await clearDraft(sb, userId);
    return null;
  }
  return data;
}

export async function saveDraft(sb, draft) {
  await sb.from('swap_drafts').upsert({
    telegram_user_id: draft.telegram_user_id,
    chat_id: draft.chat_id,
    step: draft.step,
    payload: draft.payload,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'telegram_user_id' });
}

export async function clearDraft(sb, userId) {
  await sb.from('swap_drafts').delete().eq('telegram_user_id', userId);
}

const say = (tg, token, chatId, prompt) => tg(token, 'sendMessage', {
  chat_id: chatId, text: prompt.text, parse_mode: 'Markdown',
  reply_markup: prompt.keyboard ? { inline_keyboard: prompt.keyboard } : undefined,
});

// ── Entry points ────────────────────────────────────────────────────────────

/** A photo arrived. Open a draft, or attach to the one already open. */
export async function handleSwapPhoto({ sb, tg, token, msg }) {
  const userId = msg.from?.id;
  const chatId = msg.chat.id;
  const fileId = msg.photo?.[msg.photo.length - 1]?.file_id;
  if (!userId || !fileId) return;

  const existing = await loadDraft(sb, userId);
  if (existing) {
    const { draft } = advanceDraft(existing, { kind: 'photo', fileId });
    await saveDraft(sb, draft);
    return;
  }

  const draft = newDraft({ telegramUserId: userId, chatId, fileId });
  await saveDraft(sb, draft);
  await say(tg, token, chatId, draftPrompt('await_kind', 'en'));
}

/**
 * A text message arrived. If a draft is mid-flow it belongs to the wizard, not
 * to search. Returns true when consumed.
 */
export async function handleSwapDraftText({ sb, tg, token, msg }) {
  const userId = msg.from?.id;
  if (!userId) return false;
  const draft = await loadDraft(sb, userId);
  if (!draft || draft.step === 'await_kind') return false;

  const r = advanceDraft(draft, { kind: 'text', value: msg.text });
  if (r.publish) return finishDraft({ sb, tg, token, draft: r.draft, msg });

  await saveDraft(sb, r.draft);
  if (r.prompt) await say(tg, token, msg.chat.id, r.prompt);
  return true;
}

async function finishDraft({ sb, tg, token, draft, msg }) {
  draft.telegram_username = msg.from?.username || null;
  const chatId = draft.chat_id || msg.chat.id;
  const lang = draft.payload.lang;

  if (!draft.telegram_username) {
    await clearDraft(sb, draft.telegram_user_id);
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: lang === 'am'
        ? 'ለመቀየር የቴሌግራም @username ያስፈልጋል። Settings > Username ላይ አስቀምጠው እንደገና ይሞክሩ።'
        : 'To swap, people need a way to reach you. Set a Telegram @username (Settings > Username), then send the photo again.',
    });
    return true;
  }

  const res = await publishDraft(sb, draft);
  await clearDraft(sb, draft.telegram_user_id);

  if (res.refused) {
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: res.refused === 'save_failed'
        ? "Couldn't save that — try again in a moment."
        : `Sorry, ${res.refused} can't be swapped on MiniMe.`,
    });
    return true;
  }

  await tg(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'Markdown',
    text: lang === 'am'
      ? `✅ ተለጠፈ። *${res.item.title}* የሚፈልጉ ሰዎች ያዩታል።`
      : `✅ Live. People searching for *${res.item.title}* will see it.`,
    reply_markup: { inline_keyboard: [[{ text: lang === 'am' ? '📋 የእኔ ልውውጦች' : '📋 My swaps', callback_data: 'sw:mine:0' }]] },
  });
  return true;
}

/** Route every `sw:` callback. Returns true when handled. */
export async function handleSwapCallback({ sb, tg, token, cq, rateLimitPersistent }) {
  const parsed = parseSwapCallback(cq.data);
  if (!parsed) return false;
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;

  switch (parsed.action) {
    case 'kind': {
      const draft = await loadDraft(sb, userId);
      if (!draft) return true;
      if (parsed.arg === 'find') {
        await clearDraft(sb, userId);
        await tg(token, 'sendMessage', { chat_id: chatId, text: "I can't search by picture yet — type what you're looking for." });
        return true;
      }
      const r = advanceDraft(draft, { kind: 'tap', value: 'swap' });
      await saveDraft(sb, r.draft);
      if (r.prompt) await say(tg, token, chatId, r.prompt);
      return true;
    }

    case 'cond':
    case 'area': {
      const draft = await loadDraft(sb, userId);
      if (!draft) return true;
      const r = advanceDraft(draft, { kind: 'tap', value: parsed.arg });
      if (r.publish) { await finishDraft({ sb, tg, token, draft: r.draft, msg: cq.message ? { ...cq.message, from: cq.from } : cq }); return true; }
      await saveDraft(sb, r.draft);
      if (r.prompt) await say(tg, token, chatId, r.prompt);
      return true;
    }

    case 'want': {
      // The offer line is what makes a tap cost a sentence. Park the item id
      // in a draft-shaped row so the next text message is read as the offer.
      const cap = await rateLimitPersistent(String(userId), 'swap-reveal', REVEALS_PER_DAY, 86400);
      if (!cap.ok) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: "You've asked for a lot of contacts today — try again tomorrow." });
        return true;
      }
      await saveDraft(sb, {
        telegram_user_id: userId, chat_id: chatId,
        step: 'await_offer', payload: { item_id: parsed.arg, photo_file_ids: [], lang: 'en' },
      });
      await tg(token, 'sendMessage', { chat_id: chatId, text: 'What are you offering? (one line)' });
      return true;
    }

    case 'report': {
      const { data: item } = await sb.from('swap_items').select('id, telegram_user_id').eq('id', parsed.arg).maybeSingle();
      if (item) await recordReport(sb, { itemId: item.id, reporterUserId: userId, reportedUserId: item.telegram_user_id, reason: null });
      await tg(token, 'sendMessage', { chat_id: chatId, text: 'Reported. Thank you — we review these.' });
      return true;
    }

    case 'keep': {
      const { EXPIRY_DAYS } = await import('./constants.mjs');
      await sb.from('swap_items')
        .update({ expires_at: new Date(Date.now() + EXPIRY_DAYS * 86400000).toISOString(), expiry_asked_at: null })
        .eq('id', parsed.arg);
      await tg(token, 'sendMessage', { chat_id: chatId, text: '👍 Kept live for another 3 weeks.' });
      return true;
    }

    case 'gone':
    case 'done': {
      await sb.from('swap_items').update({ status: parsed.action === 'done' ? 'swapped' : 'expired' }).eq('id', parsed.arg);
      await tg(token, 'sendMessage', { chat_id: chatId, text: parsed.action === 'done' ? '🎉 Nice one. Post closed.' : 'Closed.' });
      return true;
    }

    case 'notyet':
      await tg(token, 'sendMessage', { chat_id: chatId, text: 'No problem — it stays live.' });
      return true;

    case 'mine': {
      const { data: rows } = await sb.from('swap_items')
        .select('id, title, wants_text, status, view_count, interest_count')
        .eq('telegram_user_id', userId).neq('status', 'expired').limit(10);
      const text = rows?.length
        ? rows.map(r => `*${r.title}* → ${r.wants_text}\n👁 ${r.view_count} · 🙋 ${r.interest_count} · ${r.status}`).join('\n\n')
        : "You haven't posted anything to swap yet. Send me a photo to start.";
      await tg(token, 'sendMessage', {
        chat_id: chatId, text, parse_mode: 'Markdown',
        reply_markup: rows?.length
          ? { inline_keyboard: rows.map(r => [{ text: `🙈 Hide — ${r.title}`.slice(0, 64), callback_data: `sw:hide:${r.id}` }]) }
          : undefined,
      });
      return true;
    }

    case 'hide':
      await sb.from('swap_items').update({ status: 'hidden' }).eq('id', parsed.arg).eq('telegram_user_id', userId);
      await tg(token, 'sendMessage', { chat_id: chatId, text: 'Hidden.' });
      return true;

    default:
      return true;
  }
}

/** The offer line for a pending `sw:want`. Returns true when consumed. */
export async function handleSwapOfferText({ sb, tg, token, msg }) {
  const userId = msg.from?.id;
  const draft = userId ? await loadDraft(sb, userId) : null;
  if (!draft || draft.step !== 'await_offer') return false;

  const itemId = draft.payload.item_id;
  await clearDraft(sb, userId);

  const r = await recordInterest(sb, {
    itemId, fromUserId: userId, fromUsername: msg.from?.username, offerText: msg.text,
  });

  const chatId = msg.chat.id;
  if (r.error) {
    const text = {
      not_found: 'That swap is no longer available.',
      own_item: "That's your own post.",
      duplicate: "You've already been given their contact for this one.",
      no_username: "That person hasn't set a Telegram username, so they can't be reached.",
    }[r.error] || 'Something went wrong — try again.';
    await tg(token, 'sendMessage', { chat_id: chatId, text });
    return true;
  }

  const { toSeeker, toLister } = revealText({
    item: r.item, offerText: msg.text, fromUsername: msg.from?.username || 'someone', lang: r.item.lang,
  });

  await tg(token, 'sendMessage', {
    chat_id: chatId, text: toSeeker, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[
      { text: `💬 Open chat with @${r.item.telegram_username}`, url: `https://t.me/${r.item.telegram_username}` },
      { text: '⚠️ Report', callback_data: `sw:report:${itemId}` },
    ]] },
  });

  // The lister hears about it at the same moment, so no DM arrives cold.
  await tg(token, 'sendMessage', {
    chat_id: r.item.telegram_user_id, text: toLister, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '⚠️ Report', callback_data: `sw:report:${itemId}` }]] },
  }).catch(() => {});

  await sb.from('swap_items').update({
    interest_count: (r.item.interest_count || 0) + 1,
    first_reveal_at: r.item.first_reveal_at || new Date().toISOString(),
  }).eq('id', itemId);

  return true;
}

/** Append the swap blocks under a finished set of business results. */
export async function appendSwapBlocks({ sb, tg, token, chatId, senderId, query, parsed }) {
  if (isCommercialQuery(query)) return;
  const lang = postLang(query);

  const { haves, wants } = await fetchSwapMatches(sb, {
    keywords: parsed?.keywords || [],
    category: parsed?.category || null,
    excludeUserId: senderId,
  });

  const sel = selectSwapCards({ haves, wants, searcherArea: null });
  const block = formatSwapBlocks({ haves: sel.haves, wants: sel.wants, query, lang });

  if (!block) {
    await tg(token, 'sendMessage', { chat_id: chatId, text: swapEmptyLine(query, lang) }).catch(() => {});
    return;
  }

  await tg(token, 'sendMessage', {
    chat_id: chatId, text: block.text, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: block.keyboard },
  }).catch(() => {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/swapBotBridge.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the four call sites in `searchBot.js`**

Add the import near the other `lib/server` imports at the top:

```js
import {
  handleSwapPhoto, handleSwapDraftText, handleSwapOfferText,
  handleSwapCallback, appendSwapBlocks,
} from './swap/swapBotBridge.mjs';
import { rateLimitPersistent } from './rateLimit';
```

**(a) Photos** — `handleSearchBotUpdate` currently opens with `if (!msg?.text && !msg?.voice) return;` (about line 1213). Insert the photo branch immediately before that guard, so photos are handled instead of dropped:

```js
  // 📷 A photo is a swap post, not a search. Handled before the text/voice
  // guard below, which drops every non-text update.
  if (msg?.photo?.length) {
    await handleSwapPhoto({ sb: supabase(), tg, token, msg });
    return;
  }
  if (!msg?.text && !msg?.voice) return;
```

**(b) Draft interception** — after `text` is resolved and after the `/start`, `/help`, `/feedback` command branches, but **before** the rate-limiting block (about line 1312), add:

```js
  // A half-finished swap post owns the next message. Checked after commands
  // (so /start still escapes a stuck draft) and before the search rate limit
  // (answering "what is it?" is not a search and must not consume a slot).
  const sb = supabase();
  if (await handleSwapOfferText({ sb, tg, token, msg: { ...msg, text } })) return;
  if (await handleSwapDraftText({ sb, tg, token, msg: { ...msg, text } })) return;
```

**(c) Results** — find where `sendResults(token, chatId, reply)` is called on the main search path and add immediately after it:

```js
  await appendSwapBlocks({ sb: supabase(), tg, token, chatId, senderId, query: text, parsed });
```

Use whatever the local variable for the parsed query actually is at that point (it comes from `parseQuery`). If several call sites send results, wire only the main text/voice search path — not the pagination or grid-refresh callbacks, which would repost the same cards.

**(d) Callbacks** — at the top of `handleSearchBotCallback`, after the existing unconditional `answerCallbackQuery` (about line 1504), add:

```js
  if (await handleSwapCallback({ sb: supabase(), tg, token, cq: callbackQuery, rateLimitPersistent })) return;
```

- [ ] **Step 6: Run the whole suite**

Run: `cd apps/web && npm test`
Expected: PASS — all pre-existing tests plus the 6 new swap files.

- [ ] **Step 7: Verify the build compiles**

Run: `cd apps/web && npm run build`
Expected: build succeeds. A failure here almost certainly means a `.mjs` import path is wrong or a `.js`-only module leaked into a `.mjs` file at import time.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/server/swap/swapBotBridge.mjs \
        apps/web/src/lib/server/__tests__/swapBotBridge.test.mjs \
        apps/web/src/lib/server/searchBot.js
git commit -m "swap: wire posting, discovery and reveal into the search bot"
```

---

## Manual verification (after Task 8, before merge)

The migration must be applied by hand in the Supabase SQL editor first (`packages/db/migrations/050_swap.sql`), and `SEARCH_BOT_TOKEN` must be set for the deployed environment.

1. Send a photo to @MiniMeSearchBot → the two-button prompt appears.
2. Tap **Swap it**, answer both questions, send a second photo mid-flow, pick a condition and **Bole** → confirmation appears.
3. From a **second** Telegram account, search the item's word → the swap block appears **below** the business results, capped at three cards.
4. Tap **I'll swap for this**, type an offer → the second account gets the handle; the first account gets the heads-up with the offer text quoted.
5. Search `phone delivery` from the second account → **no** swap block at all.
6. Search a word nobody is swapping → the recruitment line appears.
7. On the first account, tap **My swaps** → the post is listed with counts; **Hide** removes it from search.
8. `GET /api/cron/swap-lifecycle` with cron auth → responds `{ ok: true, ... }` and sends nothing on a fresh post.

## Self-Review Notes

Spec coverage: §3 fields → Tasks 1, 4. §4 wizard, multi-photo, language, area fallback → Tasks 2, 3, 4, 8. §4 banned list → Task 3. §4 draft persistence → Tasks 1, 8. §5 both blocks, cap, suppression, empty state → Task 5. §6 offer line, reveal, notification, reveal cap, reports, no-username → Tasks 6, 8. §7 expiry, completion, My swaps → Tasks 7, 8. §8 schema → Task 1. §10 file layout → all (with `swapParse.mjs` and `swapBotBridge.mjs` added beyond the spec's list, both noted in the File Structure table). §11 tests → every task.

Deliberate deferrals, all spec-sanctioned non-goals: the two-sided confirmed-swap record (§9) stores `confirmed_swapped` on `swap_interests` but only the lister is asked in Task 7 — asking the interested party is a follow-up; no badge is displayed either way. `view_count` is incremented nowhere in this plan; wire it when a swap card gains a detail view.
