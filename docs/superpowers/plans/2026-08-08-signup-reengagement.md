# Signup Re-engagement Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring stalled MiniMe signups back by DMing each person a stage-specific, bilingual message built from what they actually gave us, with a working reply path and per-variant attribution.

**Architecture:** Pure decision logic (stage detection, eligibility, copy) lives in `.mjs` modules that unit tests import directly. Impure units (DB queries, artifact generation, Telegram sends) live in `.js` modules that the Next bundler resolves. A thin cron route orchestrates them. The existing `/api/cron/onboarding-nudges` route is replaced, inheriting its opt-out, cooldown, 403-handling, audit, and dry-run semantics.

**Tech Stack:** Next.js 14 App Router (Node runtime), Supabase/Postgres, Telegram Bot API, OpenAI via existing `draftReply`, `node --test` for tests.

## Global Constraints

- **Branch:** `reengagement-spec`. Do not commit to `main`.
- **Spec:** `docs/superpowers/specs/2026-08-08-signup-reengagement-design.md`. The appendix is the source of truth for all copy.
- **Testability convention (critical):** files under `src/lib/server/` use extensionless import specifiers that only the Next bundler resolves, so `node --test` cannot import them. Pure logic that needs real unit tests MUST be a `.mjs` file, imported by `.js` consumers with the explicit `.mjs` extension. This is the existing pattern — see `persuasion.mjs` imported at `src/lib/server/searchBot.js:16`.
- **Test command:** `cd apps/web && npm test` (runs `node --test src/lib/server/__tests__/*.test.mjs`).
- **Copy rules:** every interpolated number comes from a live query; a line whose number resolves to 0 is omitted entirely — never render "0 people". No claims about bugs or fixes that did not happen. All messages bilingual, English then Amharic, in one DM.
- **Markdown safety:** messages send with `parse_mode: 'Markdown'`. Interpolated shop/owner names must be escaped for `_ * [ ` ` characters.
- **Sends per person:** max 3. Global daily cap default 50, env `REENGAGE_DAILY_CAP`.
- **Never send** to: opted-out owners, platform admins (`isAdmin`), or people with 3 sends already.
- **Existing helper signatures** (do not redefine): `supabase()` from `./db`, `isCronAuthorized(request)` from `./auth`, `isAdmin(telegramId)` from `./admin`, `audit({ business_id, actor_type, actor_id, action, resource_type, resource_id, metadata, request })` from `./audit`.

---

### Task 1: Attribution table migration

**Files:**
- Create: `packages/db/migrations/039_reengagement_sends.sql`
- Test: `apps/web/src/lib/server/__tests__/reengageMigration.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: table `reengagement_sends` with columns `id`, `telegram_id BIGINT`, `business_id UUID`, `stage TEXT`, `variant TEXT`, `sent_at TIMESTAMPTZ`, `replied_at TIMESTAMPTZ`, `exit_reason TEXT`, `outcome TEXT`. Used by Tasks 6, 7, 8.

- [ ] **Step 1: Write the failing test**

```javascript
// apps/web/src/lib/server/__tests__/reengageMigration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const sql = readFileSync(`${root}packages/db/migrations/039_reengagement_sends.sql`, 'utf8');

test('table is created idempotently', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS reengagement_sends/);
});

test('every column the engine writes exists', () => {
  for (const col of ['telegram_id', 'business_id', 'stage', 'variant', 'sent_at', 'replied_at', 'exit_reason', 'outcome']) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `missing column ${col}`);
  }
});

test('business_id is UUID to match businesses.id', () => {
  assert.match(sql, /business_id\s+UUID/i);
});

test('lookups by recipient and recency are indexed', () => {
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[\s\S]*telegram_id/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[\s\S]*sent_at/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageMigration.test.mjs`
Expected: FAIL — `ENOENT: no such file or directory` for the migration.

- [ ] **Step 3: Write the migration**

```sql
-- 039_reengagement_sends.sql
-- Attribution for the signup re-engagement engine.
--
-- Without this table we can send nudges but never learn which stage or which
-- copy variant actually brought anyone back, which makes copy iteration
-- guesswork. One row per DM sent.

CREATE TABLE IF NOT EXISTS reengagement_sends (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id  BIGINT NOT NULL,
  business_id  UUID,
  stage        TEXT NOT NULL,
  variant      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ DEFAULT now(),
  replied_at   TIMESTAMPTZ,
  exit_reason  TEXT,
  outcome      TEXT
);

CREATE INDEX IF NOT EXISTS idx_reengagement_sends_telegram
  ON reengagement_sends (telegram_id);

CREATE INDEX IF NOT EXISTS idx_reengagement_sends_sent
  ON reengagement_sends (sent_at DESC);

-- Outcome backfill scans unresolved sends; keep that scan cheap.
CREATE INDEX IF NOT EXISTS idx_reengagement_sends_unresolved
  ON reengagement_sends (sent_at) WHERE outcome IS NULL;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageMigration.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/039_reengagement_sends.sql apps/web/src/lib/server/__tests__/reengageMigration.test.mjs
git commit -m "Add reengagement_sends table for nudge attribution"
```

---

### Task 2: Telemetry repairs the stage ladder depends on

**Files:**
- Modify: `apps/web/src/app/api/onboarding/track/route.js` (the `VALID_STEPS` set)
- Modify: `apps/web/src/app/api/agent-bot/webhook/route.js` (remove `logFunnel` helper at ~line 185 and its call sites)
- Test: `apps/web/src/lib/server/__tests__/reengageTelemetry.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `tour_started`, `tour_finished`, `tour_skipped` become recordable steps. No behavioural export.

Context: the wizard fires `track('tour_started')`, `track('tour_finished')`, and `track('tour_skipped')` at `src/app/(dashboard)/onboarding/page.js:2849-2856`, but they are not in `VALID_STEPS`, so they are silently dropped — a blind spot at the top of the funnel. Separately, `funnel_events` has no migration, so every `logFunnel` write silently no-ops; the comment at `webhook/route.js:992` already documents this. Delete that dead path rather than leave a helper that looks like it works.

- [ ] **Step 1: Write the failing test**

```javascript
// apps/web/src/lib/server/__tests__/reengageTelemetry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const track = readFileSync(`${root}apps/web/src/app/api/onboarding/track/route.js`, 'utf8');
const webhook = readFileSync(`${root}apps/web/src/app/api/agent-bot/webhook/route.js`, 'utf8');

test('tour steps the wizard actually fires are accepted, not dropped', () => {
  for (const step of ['tour_started', 'tour_finished', 'tour_skipped']) {
    assert.match(track, new RegExp(`'${step}'`), `${step} missing from VALID_STEPS`);
  }
});

test('the silently no-op funnel_events path is gone', () => {
  assert.ok(!/funnel_events/.test(webhook), 'funnel_events writes still present');
  assert.ok(!/logFunnel/.test(webhook), 'logFunnel helper still present');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageTelemetry.test.mjs`
Expected: FAIL — both tests fail (`tour_started` missing; `funnel_events` still present).

- [ ] **Step 3: Add the tour steps to VALID_STEPS**

In `src/app/api/onboarding/track/route.js`, inside the `VALID_STEPS` set, after the `'app_open', 'welcome', 'sell', 'demo', 'teach',` line, add:

```javascript
  // Product tour, fired from the wizard's Welcome screen. These were dropped
  // by this whitelist until now, leaving the top of the funnel unmeasurable.
  'tour_started', 'tour_finished', 'tour_skipped',
```

- [ ] **Step 4: Delete the dead funnel_events path**

In `src/app/api/agent-bot/webhook/route.js`:
1. Delete the `logFunnel` function (the `async function logFunnel(event, userId, fields = {})` block near line 185) together with the comment block above it that documents the `funnel_events` events.
2. Delete every `await logFunnel(...)` call. At the time of writing these are at roughly lines 872 (`bot_token_pasted`), 958 (`command_used`), and 1035 (`signup_started`). Grep to confirm none remain: `grep -n "logFunnel" src/app/api/agent-bot/webhook/route.js` must return nothing.
3. At line ~992 there is a comment explaining that `sell_cta_tapped` uses `onboarding_events` "NOT logFunnel/funnel_events". Shorten it to just state that the tap is tracked in `onboarding_events`, since the contrast no longer exists.

- [ ] **Step 5: Run tests and the build**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageTelemetry.test.mjs`
Expected: PASS, 2 tests.

Run: `cd apps/web && npm run build`
Expected: build succeeds. This catches a stray `logFunnel` reference the grep missed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/onboarding/track/route.js apps/web/src/app/api/agent-bot/webhook/route.js apps/web/src/lib/server/__tests__/reengageTelemetry.test.mjs
git commit -m "Record tour steps and delete the no-op funnel_events path"
```

---

### Task 3: Stage detection

**Files:**
- Create: `apps/web/src/lib/server/reengage/stages.mjs`
- Test: `apps/web/src/lib/server/__tests__/reengageStages.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `STAGES` — ordered array `['A1','B1','B2','B3','B4','B5']`.
  - `detectStage({ steps, business })` → stage string or `null`. `steps` is an array of step-name strings (order irrelevant). `business` is the `businesses` row or `null`.
  - Used by Tasks 5, 6, 7, 8.

Stage rules, from the spec's ladder. Later rungs win — a person's stage is the furthest rung they reached:

| Stage | Reached | Not reached |
|---|---|---|
| A1 | `sell_cta_tapped`/`app_open`/`welcome`/`tour_*` | no business row |
| B1 | business row exists | `shop_name_saved` |
| B2 | `shop_name_saved` | `customer_chat_finished`/`customer_chat_skipped` |
| B3 | chat finished/skipped | `tryit_replied` |
| B4 | `tryit_replied` | any step starting `connect` |
| B5 | `connect_custom` | `connected_custom` |

- [ ] **Step 1: Write the failing test**

```javascript
// apps/web/src/lib/server/__tests__/reengageStages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStage, STAGES } from '../reengage/stages.mjs';

const biz = { id: 'b1', name: 'Selam Shop' };

test('no business row and only a Sell tap is the top rung', () => {
  assert.equal(detectStage({ steps: ['sell_cta_tapped'], business: null }), 'A1');
});

test('a dropped tour step still counts as A1, not as nothing', () => {
  assert.equal(detectStage({ steps: ['tour_started'], business: null }), 'A1');
});

test('a business row with no shop name saved is B1, not A1', () => {
  // The row is created at the "Let's go" tap with a placeholder name, so its
  // mere existence does not mean the owner named their shop.
  assert.equal(detectStage({ steps: ['signup'], business: biz }), 'B1');
});

test('naming the shop advances to B2', () => {
  assert.equal(detectStage({ steps: ['signup', 'shop_name_saved'], business: biz }), 'B2');
});

test('skipping the chat counts as finishing it', () => {
  assert.equal(detectStage({ steps: ['shop_name_saved', 'customer_chat_skipped'], business: biz }), 'B3');
});

test('a replied try-it with no connect attempt is B4', () => {
  assert.equal(detectStage({ steps: ['shop_name_saved', 'customer_chat_finished', 'tryit_replied'], business: biz }), 'B4');
});

test('starting the custom-bot connect is B5', () => {
  assert.equal(detectStage({ steps: ['tryit_replied', 'connect_custom'], business: biz }), 'B5');
});

test('a completed connection is not a stall at all', () => {
  assert.equal(detectStage({ steps: ['connect_custom', 'connected_custom'], business: biz }), null);
  assert.equal(detectStage({ steps: ['connect_shared', 'connected_shared'], business: biz }), null);
});

test('event order never matters — only the furthest rung reached', () => {
  const forward = detectStage({ steps: ['signup', 'shop_name_saved', 'tryit_replied'], business: biz });
  const shuffled = detectStage({ steps: ['tryit_replied', 'shop_name_saved', 'signup'], business: biz });
  assert.equal(forward, shuffled);
});

test('an empty history with no business row is not a candidate', () => {
  assert.equal(detectStage({ steps: [], business: null }), null);
});

test('stages are exported in funnel order', () => {
  assert.deepEqual(STAGES, ['A1', 'B1', 'B2', 'B3', 'B4', 'B5']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageStages.test.mjs`
Expected: FAIL — cannot find module `../reengage/stages.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// apps/web/src/lib/server/reengage/stages.mjs
/**
 * Where in the signup funnel did this person stall?
 *
 * The answer comes from onboarding_events (migration 026), which records one
 * whitelisted step per wizard screen keyed by telegram_id. A person's stage is
 * the FURTHEST rung they reached, so event order and duplicates never matter.
 *
 * Pure — no I/O — so it is unit-testable by direct import. Kept as .mjs
 * because src/lib/server/*.js uses extensionless specifiers that only the Next
 * bundler resolves and node --test cannot.
 */

export const STAGES = ['A1', 'B1', 'B2', 'B3', 'B4', 'B5'];

const TOUCHED_APP = ['sell_cta_tapped', 'app_open', 'welcome', 'tour_started', 'tour_finished', 'tour_skipped'];
const CHAT_DONE   = ['customer_chat_finished', 'customer_chat_skipped'];
const CONNECTED   = ['connected_custom', 'connected_shared'];

/**
 * @param {{ steps: string[], business: object|null }} input
 * @returns {string|null} stage id, or null if this person is not a stalled candidate
 */
export function detectStage({ steps, business }) {
  const seen = new Set(steps || []);
  const has = (...names) => names.some(n => seen.has(n));

  // Already live — nothing to re-engage.
  if (has(...CONNECTED)) return null;
  if (business?.onboarding_completed || business?.telegram_bot_username) return null;

  // Furthest rung first.
  if (seen.has('connect_custom')) return 'B5';
  if (seen.has('tryit_replied')) return 'B4';
  if (has(...CHAT_DONE)) return 'B3';
  if (seen.has('shop_name_saved')) return 'B2';

  // The businesses row is created at the "Let's go" tap with a placeholder
  // name, so a row alone means "account, unnamed" — not "named their shop".
  if (business) return 'B1';

  if (has(...TOUCHED_APP)) return 'A1';

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageStages.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/reengage/stages.mjs apps/web/src/lib/server/__tests__/reengageStages.test.mjs
git commit -m "Add stage detection for stalled signups"
```

---

### Task 4: Eligibility, cooldown, and variant assignment

**Files:**
- Create: `apps/web/src/lib/server/reengage/eligibility.mjs`
- Test: `apps/web/src/lib/server/__tests__/reengageEligibility.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_SENDS = 3`, `SEND_SCHEDULE_DAYS = [1, 3, 10]`, `MIN_AGE_MS`.
  - `decideSend({ stage, sends, stalledAt, optedOut, isAdminUser, now })` → `{ send: boolean, reason: string, sendIndex: number|null, isFinal: boolean }`.
  - `pickVariant(telegramId, stage)` → `'demand' | 'payoff'`, deterministic so a person never flip-flops between variants across sends.
  - Used by Tasks 6, 7.

`sends` is an array of prior `reengagement_sends` rows (each with `sent_at`) for this person, newest-first or any order. `stalledAt` is the timestamp of their most recent onboarding event. Send *n* is due once `stalledAt + SEND_SCHEDULE_DAYS[n]` days have passed. `isFinal` is true on the third send, which is always the exit question.

- [ ] **Step 1: Write the failing test**

```javascript
// apps/web/src/lib/server/__tests__/reengageEligibility.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSend, pickVariant, MAX_SENDS, SEND_SCHEDULE_DAYS } from '../reengage/eligibility.mjs';

const DAY = 86400000;
const now = Date.parse('2026-08-08T17:00:00Z');
const base = { stage: 'B4', sends: [], optedOut: false, isAdminUser: false, now };

test('someone who stalled an hour ago is not nudged mid-signup', () => {
  const d = decideSend({ ...base, stalledAt: new Date(now - 3600_000).toISOString() });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'too_new');
});

test('the first send goes out once day 1 has passed', () => {
  const d = decideSend({ ...base, stalledAt: new Date(now - 2 * DAY).toISOString() });
  assert.equal(d.send, true);
  assert.equal(d.sendIndex, 0);
  assert.equal(d.isFinal, false);
});

test('opting out silences everything, however long they have stalled', () => {
  const d = decideSend({ ...base, stalledAt: new Date(now - 30 * DAY).toISOString(), optedOut: true });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'opted_out');
});

test('platform admins are never nudged', () => {
  const d = decideSend({ ...base, stalledAt: new Date(now - 30 * DAY).toISOString(), isAdminUser: true });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'suppressed_admin');
});

test('a second send waits for its scheduled day, not just for the cooldown', () => {
  const stalledAt = new Date(now - 2 * DAY).toISOString();
  const sends = [{ sent_at: new Date(now - 1 * DAY).toISOString() }];
  const d = decideSend({ ...base, stalledAt, sends });
  assert.equal(d.send, false, 'day 3 has not arrived yet');
});

test('the second send goes out on day 3', () => {
  const stalledAt = new Date(now - 4 * DAY).toISOString();
  const sends = [{ sent_at: new Date(now - 3 * DAY).toISOString() }];
  const d = decideSend({ ...base, stalledAt, sends });
  assert.equal(d.send, true);
  assert.equal(d.sendIndex, 1);
});

test('the third send is the final one and is flagged as such', () => {
  const stalledAt = new Date(now - 11 * DAY).toISOString();
  const sends = [
    { sent_at: new Date(now - 10 * DAY).toISOString() },
    { sent_at: new Date(now - 8 * DAY).toISOString() },
  ];
  const d = decideSend({ ...base, stalledAt, sends });
  assert.equal(d.send, true);
  assert.equal(d.sendIndex, 2);
  assert.equal(d.isFinal, true);
});

test('after three sends we stop permanently', () => {
  const stalledAt = new Date(now - 90 * DAY).toISOString();
  const sends = [1, 2, 3].map(i => ({ sent_at: new Date(now - (20 + i) * DAY).toISOString() }));
  const d = decideSend({ ...base, stalledAt, sends });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'max_sends');
  assert.equal(sends.length, MAX_SENDS);
});

test('a person with no stage is never a candidate', () => {
  const d = decideSend({ ...base, stage: null, stalledAt: new Date(now - 30 * DAY).toISOString() });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'no_stage');
});

test('variant assignment is stable across sends for the same person', () => {
  assert.equal(pickVariant(12345, 'B4'), pickVariant(12345, 'B4'));
});

test('variant assignment splits the population across both arms', () => {
  const arms = new Set();
  for (let id = 1; id <= 200; id++) arms.add(pickVariant(id, 'B4'));
  assert.deepEqual([...arms].sort(), ['demand', 'payoff']);
});

test('the schedule is the documented day 1 / 3 / 10', () => {
  assert.deepEqual(SEND_SCHEDULE_DAYS, [1, 3, 10]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageEligibility.test.mjs`
Expected: FAIL — cannot find module `../reengage/eligibility.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// apps/web/src/lib/server/reengage/eligibility.mjs
/**
 * Should this person get a nudge right now, and which one?
 *
 * Two independent brakes, because either alone fails: a per-person schedule
 * (day 1 / 3 / 10, then permanent stop) and a hard cap of 3 sends. Nagging a
 * stalled signup costs more trust than the signup is worth.
 *
 * Pure — no I/O, clock injected — so it is unit-testable by direct import.
 */

export const MAX_SENDS = 3;
export const SEND_SCHEDULE_DAYS = [1, 3, 10];
export const MIN_AGE_MS = 24 * 3600_000; // day 1 — never ping someone mid-signup

const DAY_MS = 86400000;

/**
 * @returns {{ send: boolean, reason: string, sendIndex: number|null, isFinal: boolean }}
 */
export function decideSend({ stage, sends = [], stalledAt, optedOut = false, isAdminUser = false, now = Date.now() }) {
  const no = (reason) => ({ send: false, reason, sendIndex: null, isFinal: false });

  if (!stage) return no('no_stage');
  if (optedOut) return no('opted_out');
  if (isAdminUser) return no('suppressed_admin');

  const sentCount = sends.length;
  if (sentCount >= MAX_SENDS) return no('max_sends');

  const stalledMs = stalledAt ? new Date(stalledAt).getTime() : NaN;
  if (!Number.isFinite(stalledMs)) return no('unknown_stall_time');

  const age = now - stalledMs;
  if (age < MIN_AGE_MS) return no('too_new');

  // Send n is due once its scheduled day has passed since the stall.
  const dueAfter = SEND_SCHEDULE_DAYS[sentCount] * DAY_MS;
  if (age < dueAfter) return no('not_due');

  return {
    send: true,
    reason: 'due',
    sendIndex: sentCount,
    isFinal: sentCount === MAX_SENDS - 1,
  };
}

/**
 * Deterministic A/B split. Keyed on the person alone (not the stage) so their
 * arm never flips between sends — otherwise attribution measures nothing.
 */
export function pickVariant(telegramId /* , stage */) {
  const n = Number(telegramId) || 0;
  return n % 2 === 0 ? 'demand' : 'payoff';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageEligibility.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/reengage/eligibility.mjs apps/web/src/lib/server/__tests__/reengageEligibility.test.mjs
git commit -m "Add send scheduling and variant assignment for re-engagement"
```

---

### Task 5: Bilingual copy

**Files:**
- Create: `apps/web/src/lib/server/reengage/copy.mjs`
- Test: `apps/web/src/lib/server/__tests__/reengageCopy.test.mjs`

**Interfaces:**
- Consumes: `STAGES` from `stages.mjs` (for coverage assertions in tests only).
- Produces:
  - `escapeMd(text)` → string safe for `parse_mode: 'Markdown'`.
  - `renderMessage({ stage, variant, isFinal, facts })` → `{ text: string, buttons: Array<Array<{ text, action }>> }`.
  - `facts` shape: `{ first, shop, waiting, unanswered, products, factCount, question, draft }` — any field may be missing.
  - `action` is a stable string the send layer maps to a Telegram button: `'open_app'`, `'open_teach'`, `'open_connect'`, `'go_shared'`, `'help_token'`, or `'exit:<reason>'`.
  - Used by Tasks 6, 7.

Copy is the spec appendix verbatim. Zero-valued numbers omit their whole line.

- [ ] **Step 1: Write the failing test**

```javascript
// apps/web/src/lib/server/__tests__/reengageCopy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMessage, escapeMd } from '../reengage/copy.mjs';
import { STAGES } from '../reengage/stages.mjs';

const facts = {
  first: 'Abebe', shop: 'Selam Shop', waiting: 12, unanswered: 40,
  products: 14, factCount: 6, question: 'Do you deliver?', draft: 'Yes, we deliver across Addis.',
};

test('every stage renders in both variants with text and at least one button', () => {
  for (const stage of STAGES) {
    for (const variant of ['demand', 'payoff']) {
      const m = renderMessage({ stage, variant, isFinal: false, facts });
      assert.ok(m.text.length > 40, `${stage}/${variant} text too short`);
      assert.ok(m.buttons.flat().length >= 1, `${stage}/${variant} has no button`);
    }
  }
});

test('every message is bilingual — Amharic script is always present', () => {
  for (const stage of STAGES) {
    const m = renderMessage({ stage, variant: 'demand', isFinal: false, facts });
    assert.match(m.text, /[ሀ-፿]/, `${stage} has no Amharic`);
  }
});

test('we never quote a zero — the demand line is dropped, not rendered as 0', () => {
  const m = renderMessage({ stage: 'A1', variant: 'demand', isFinal: false, facts: { first: 'Abebe', waiting: 0, unanswered: 0 } });
  assert.ok(!/\b0 people\b/.test(m.text), 'rendered "0 people"');
  assert.ok(!/\b0 searches\b/.test(m.text), 'rendered "0 searches"');
  assert.ok(m.text.length > 40, 'dropping the number must not leave an empty message');
});

test('a real waiting count is quoted', () => {
  const m = renderMessage({ stage: 'A1', variant: 'demand', isFinal: false, facts });
  assert.match(m.text, /12/);
});

test('the final send is the exit question with four reason chips', () => {
  const m = renderMessage({ stage: 'B4', variant: 'payoff', isFinal: true, facts });
  const actions = m.buttons.flat().map(b => b.action);
  assert.equal(actions.length, 4);
  for (const a of actions) assert.match(a, /^exit:/);
});

test('B5 offers the shared-mode escape hatch, which is its whole point', () => {
  const m = renderMessage({ stage: 'B5', variant: 'payoff', isFinal: false, facts });
  const actions = m.buttons.flat().map(b => b.action);
  assert.ok(actions.includes('go_shared'));
  assert.ok(actions.includes('help_token'));
});

test('B2 shows the generated reply it promises', () => {
  const m = renderMessage({ stage: 'B2', variant: 'payoff', isFinal: false, facts });
  assert.ok(m.text.includes('Do you deliver?'));
  assert.ok(m.text.includes('Yes, we deliver across Addis.'));
});

test('no message claims we fixed a bug', () => {
  for (const stage of STAGES) {
    for (const variant of ['demand', 'payoff']) {
      const m = renderMessage({ stage, variant, isFinal: false, facts });
      assert.ok(!/\bbug\b/i.test(m.text), `${stage}/${variant} claims a bug fix`);
    }
  }
});

test('Markdown emphasis is balanced so Telegram does not reject the send', () => {
  for (const stage of STAGES) {
    const m = renderMessage({ stage, variant: 'demand', isFinal: false, facts });
    assert.equal((m.text.match(/\*/g) || []).length % 2, 0, `${stage} has unbalanced *`);
    assert.equal((m.text.match(/_/g) || []).length % 2, 0, `${stage} has unbalanced _`);
  }
});

test('names with Markdown characters are escaped, not left to corrupt the message', () => {
  assert.equal(escapeMd('Selam_Shop *Addis*'), 'Selam\\_Shop \\*Addis\\*');
  const m = renderMessage({ stage: 'B4', variant: 'payoff', isFinal: false, facts: { ...facts, shop: 'A_B' } });
  assert.ok(m.text.includes('A\\_B'));
});

test('a missing first name degrades to a greeting, never to "undefined"', () => {
  const m = renderMessage({ stage: 'A1', variant: 'payoff', isFinal: false, facts: { waiting: 3 } });
  assert.ok(!/undefined|null/.test(m.text));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageCopy.test.mjs`
Expected: FAIL — cannot find module `../reengage/copy.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// apps/web/src/lib/server/reengage/copy.mjs
/**
 * Bilingual re-engagement copy, one template per stage × variant.
 *
 * Rules that the tests pin, because breaking them costs trust:
 *   - Every interpolated number comes from a live query. A number that
 *     resolves to 0 drops its whole line — we never say "0 people".
 *   - English then Amharic in one message; no language detection, because the
 *     signal is sparse and a bilingual message is never unreadable.
 *   - No claims about bugs or fixes that did not happen.
 *
 * The Amharic here needs a native-speaker review pass before the first
 * production send — machine-adjacent translation goes subtly wrong in sales
 * copy exactly where tone matters.
 *
 * Pure — no I/O — so it is unit-testable by direct import.
 */

/** Escape the characters Telegram's legacy Markdown parser treats as syntax. */
export function escapeMd(text) {
  return String(text ?? '').replace(/([_*\[\]`])/g, '\\$1');
}

const nameOr = (v, fallback) => (v ? escapeMd(v) : fallback);

/** Demand proof, or '' when there is no honest number to quote. */
function demandLine({ waiting, unanswered }) {
  if (waiting > 0) {
    return `*${waiting} ${waiting === 1 ? 'person' : 'people'}* searched MiniMe for a shop like yours and found nobody.\n\n` +
      `That's ${waiting} ${waiting === 1 ? 'customer' : 'customers'} with money ready and nowhere to spend it.`;
  }
  if (unanswered > 0) {
    return `In the last 90 days, *${unanswered} ${unanswered === 1 ? 'search' : 'searches'}* on MiniMe came up empty — real customers with no shop to send them to.`;
  }
  return '';
}

function demandLineAm({ waiting, unanswered }) {
  if (waiting > 0) return `*${waiting} ሰዎች* እንደ እርስዎ ያለ ሱቅ በMiniMe ላይ ፈልገው አላገኙም።`;
  if (unanswered > 0) return `ባለፉት 90 ቀናት *${unanswered} ፍለጋዎች* ያለ ውጤት ቀርተዋል።`;
  return '';
}

const OPEN_APP     = [[{ text: '📱 List my shop — 1 min', action: 'open_app' }]];
const TEACH_IT     = [[{ text: '🎓 Teach it — 2 min', action: 'open_teach' }]];
const TURN_IT_ON   = [[{ text: '⚡ Turn it on', action: 'open_connect' }]];
const SHARED_OR_TOKEN = [
  [{ text: '⚡ Skip it — go live now', action: 'go_shared' }],
  [{ text: '🔑 No, help me with the token', action: 'help_token' }],
];

const EXIT_BUTTONS = [
  [{ text: '😵 Too complicated', action: 'exit:too_complicated' },
   { text: '⏰ No time', action: 'exit:no_time' }],
  [{ text: '💸 Too expensive', action: 'exit:too_expensive' },
   { text: '👀 Just looking', action: 'exit:just_looking' }],
];

function exitMessage(facts) {
  const first = nameOr(facts.first, 'Hi');
  const shop = nameOr(facts.shop, 'your shop');
  return {
    text:
      `${first}, last message from me — I promise 🙏\n\n` +
      `You started setting up *${shop}* but didn't finish, and I'd genuinely like to know why. ` +
      `One tap, and it helps me fix it for the next person.\n\n` +
      `አንድ ንክኪ ብቻ — ለምን እንዳላጠናቀቁ ማወቅ እፈልጋለሁ።`,
    buttons: EXIT_BUTTONS,
  };
}

/** The "what are you missing" pitch — used by A1 and B1. */
function curious(facts, variant) {
  const first = nameOr(facts.first, 'there');
  const en = demandLine(facts);
  const am = demandLineAm(facts);

  if (variant === 'demand' && en) {
    return {
      text:
        `👋 Hi ${first} — ${en}\n\n` +
        `Listing your shop is free and takes about a minute.\n\n` +
        `${am}\nሱቅዎን መዘርዘር ነጻ ነው፣ አንድ ደቂቃ ብቻ ይወስዳል።`,
      buttons: OPEN_APP,
    };
  }

  // Payoff angle — also the fallback when there is no honest number to quote.
  return {
    text:
      `👋 Hi ${first} — you looked at MiniMe but never started.\n\n` +
      `Here's the whole thing in one line: *your customers message your Telegram, MiniMe answers them in your voice, 24/7, in Amharic and English.* You don't type anything.\n\n` +
      `ደንበኞችዎ ይጽፋሉ፣ MiniMe በእርስዎ አነጋገር ይመልስላቸዋል — 24/7፣ በአማርኛና በእንግሊዝኛ።`,
    buttons: OPEN_APP,
  };
}

/** Show a real generated reply — used by B2 and B3. */
function showReply(facts) {
  const first = nameOr(facts.first, 'there');
  const shop = nameOr(facts.shop, 'your shop');
  const q = escapeMd(facts.question || 'Do you deliver?');
  const draft = escapeMd(facts.draft || 'Yes — we deliver across Addis, same day.');
  return {
    text:
      `Hi ${first} 👋 — curious what *${shop}* would sound like on MiniMe?\n\n` +
      `A customer asks: _"${q}"_\n` +
      `${shop} replies: _"${draft}"_\n\n` +
      `MiniMe wrote that from nothing but your shop name. Two minutes of teaching and it'll know your prices, hours, and how you talk.\n\n` +
      `ይሄንን የጻፈው የሱቅዎን ስም ብቻ አይቶ ነው። ሁለት ደቂቃ ካስተማሩት ዋጋዎን፣ ሰዓትዎን እና አነጋገርዎን ይማራል።`,
    buttons: TEACH_IT,
  };
}

/** Trained and tested but never switched on — B4. */
function readyAndWaiting(facts) {
  const first = nameOr(facts.first, 'there');
  const shop = nameOr(facts.shop, 'your shop');
  const knows = facts.products > 0
    ? `It already knows ${facts.products} of your products` +
      (facts.factCount > 0 ? ` and ${facts.factCount} things about how *${shop}* works` : '') + '. '
    : '';
  return {
    text:
      `${first}, your assistant is *ready and waiting.*\n\n` +
      `${knows}It replies in your voice, in Amharic and English.\n\n` +
      `Right now it's answering nobody. One tap turns it on.\n\n` +
      `ረዳትዎ ተዘጋጅቷል። አሁን ግን ማንንም እያገለገለ አይደለም። አንድ ንክኪ ብቻ።`,
    buttons: TURN_IT_ON,
  };
}

/** Stalled at BotFather — B5. The escape hatch is the entire point. */
function botfatherEscape(facts) {
  const first = nameOr(facts.first, 'there');
  return {
    text:
      `${first} — you did all the hard work. You got stuck on the BotFather step, and honestly, that's the worst part of the whole setup.\n\n` +
      `*You can skip it entirely.* Tap below and MiniMe answers your customers through @MiniMeAgentBot instead. No token, no BotFather, works right now.\n\n` +
      `የBotFather ደረጃው ከባዱ ክፍል ነው — መዝለል ይችላሉ። MiniMe በ@MiniMeAgentBot በኩል ደንበኞችዎን ይመልሳል።`,
    buttons: SHARED_OR_TOKEN,
  };
}

const BY_STAGE = {
  A1: curious,
  B1: curious,
  B2: (facts) => showReply(facts),
  B3: (facts) => showReply(facts),
  B4: (facts) => readyAndWaiting(facts),
  B5: (facts) => botfatherEscape(facts),
};

/**
 * @param {{ stage: string, variant: 'demand'|'payoff', isFinal: boolean, facts: object }} input
 * @returns {{ text: string, buttons: Array<Array<{text: string, action: string}>> }}
 */
export function renderMessage({ stage, variant = 'payoff', isFinal = false, facts = {} }) {
  if (isFinal) return exitMessage(facts);
  const build = BY_STAGE[stage];
  if (!build) return exitMessage(facts); // unknown stage never sends silence
  return build(facts, variant);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageCopy.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/reengage/copy.mjs apps/web/src/lib/server/__tests__/reengageCopy.test.mjs
git commit -m "Add bilingual stage-aware re-engagement copy"
```

---

### Task 6: Audience query and artifact building

**Files:**
- Create: `apps/web/src/lib/server/reengage/audience.js`
- Create: `apps/web/src/lib/server/reengage/artifacts.js`
- Test: `apps/web/src/lib/server/__tests__/reengageAudience.test.mjs`

**Interfaces:**
- Consumes: `detectStage` from `./stages.mjs`, `decideSend`/`pickVariant` from `./eligibility.mjs`, `supabase()` from `../db`, `isAdmin` from `../admin`, `draftReply` from `../replyEngine`.
- Produces:
  - `audience.js`: `loadCandidates({ now, cap })` → `Promise<Array<{ telegramId, business, steps, stalledAt, sends, stage, variant, decision }>>`, already filtered to `decision.send === true`, sorted oldest-stall-first, truncated to `cap`.
  - `artifacts.js`: `buildFacts({ stage, business, telegramId })` → `Promise<facts>` matching the shape `renderMessage` consumes.
  - Used by Task 7.

These two units do I/O, so they are `.js` (bundler-resolved) and are tested by source assertion, matching the `sendNudge.test.mjs` precedent. Their decision logic is already unit-tested in Tasks 3–5; what these tests pin is that the dangerous properties hold.

- [ ] **Step 1: Write the failing test**

```javascript
// apps/web/src/lib/server/__tests__/reengageAudience.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const audience  = readFileSync(`${root}apps/web/src/lib/server/reengage/audience.js`, 'utf8');
const artifacts = readFileSync(`${root}apps/web/src/lib/server/reengage/artifacts.js`, 'utf8');

test('the daily cap is applied, so a first run cannot blast the whole backlog', () => {
  assert.match(audience, /REENGAGE_DAILY_CAP/);
  assert.match(audience, /slice\(0,\s*cap\)/);
});

test('the backlog drains oldest-first', () => {
  assert.match(audience, /sort\(/);
  assert.match(audience, /stalledAt/);
});

test('admin suppression is wired to the real allowlist, not reimplemented', () => {
  assert.match(audience, /import \{ isAdmin \}/);
  assert.match(audience, /isAdminUser:\s*isAdmin\(/);
});

test('opt-out is read from the same flag STOP writes', () => {
  assert.match(audience, /owner_nudges/);
  assert.match(audience, /opted_out/);
});

test('artifact generation never quotes a number it did not fetch', () => {
  // Zero-safety lives in copy.mjs; artifacts must pass real counts or nothing.
  assert.match(artifacts, /search_waitlist/);
  assert.match(artifacts, /search_logs/);
});

test('a failed artifact degrades instead of skipping the person', () => {
  assert.match(artifacts, /catch/);
  assert.ok(/return\s*\{[^}]*first/.test(artifacts), 'must still return baseline facts on failure');
});

test('the expensive draftReply path runs only for the stage that shows a reply', () => {
  assert.match(artifacts, /stage === 'B2' \|\| stage === 'B3'/);
});

test('draftReply runs in preview mode so it never writes to live conversations', () => {
  assert.match(artifacts, /preview:\s*true/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageAudience.test.mjs`
Expected: FAIL — `ENOENT` for `reengage/audience.js`.

- [ ] **Step 3: Write `audience.js`**

```javascript
// apps/web/src/lib/server/reengage/audience.js
/**
 * Who gets a nudge on this run?
 *
 * Candidates come from onboarding_events (every telegram_id that ever touched
 * the funnel), left-joined to businesses. Stage detection and the send
 * schedule are pure and live in stages.mjs / eligibility.mjs; this module is
 * only the I/O and the ordering around them.
 *
 * The daily cap is the safety valve: the first production run faces the entire
 * historical backlog, and blasting it would spend every dormant lead on one
 * untested piece of copy.
 */
import { supabase } from '../db';
import { isAdmin } from '../admin';
import { detectStage } from './stages.mjs';
import { decideSend, pickVariant } from './eligibility.mjs';

export const DEFAULT_CAP = Number(process.env.REENGAGE_DAILY_CAP || 50);

export async function loadCandidates({ now = Date.now(), cap = DEFAULT_CAP } = {}) {
  const sb = supabase();

  const { data: events, error: evErr } = await sb
    .from('onboarding_events')
    .select('telegram_id, step, created_at')
    .not('telegram_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50000);
  if (evErr) throw new Error(`onboarding_events query failed: ${evErr.message}`);

  // Fold to one record per person: their step set and their most recent event.
  const byUser = new Map();
  for (const e of events || []) {
    const key = String(e.telegram_id);
    let rec = byUser.get(key);
    if (!rec) {
      rec = { telegramId: e.telegram_id, steps: [], stalledAt: e.created_at };
      byUser.set(key, rec);
    }
    rec.steps.push(e.step);
    if (new Date(e.created_at) > new Date(rec.stalledAt)) rec.stalledAt = e.created_at;
  }
  if (!byUser.size) return [];

  const ids = [...byUser.values()].map(r => r.telegramId);

  const { data: businesses } = await sb
    .from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, onboarding_completed, telegram_bot_username, notification_prefs')
    .in('owner_telegram_id', ids);
  const bizByOwner = new Map((businesses || []).map(b => [String(b.owner_telegram_id), b]));

  const { data: priorSends } = await sb
    .from('reengagement_sends')
    .select('telegram_id, sent_at')
    .in('telegram_id', ids);
  const sendsByUser = new Map();
  for (const s of priorSends || []) {
    const key = String(s.telegram_id);
    if (!sendsByUser.has(key)) sendsByUser.set(key, []);
    sendsByUser.get(key).push(s);
  }

  const eligible = [];
  for (const rec of byUser.values()) {
    const key = String(rec.telegramId);
    const business = bizByOwner.get(key) || null;
    const stage = detectStage({ steps: rec.steps, business });
    const sends = sendsByUser.get(key) || [];
    const optedOut = business?.notification_prefs?.owner_nudges?.opted_out === true;

    const decision = decideSend({
      stage,
      sends,
      stalledAt: rec.stalledAt,
      optedOut,
      isAdminUser: isAdmin(rec.telegramId),
      now,
    });
    if (!decision.send) continue;

    eligible.push({
      telegramId: rec.telegramId,
      business,
      steps: rec.steps,
      stalledAt: rec.stalledAt,
      sends,
      stage,
      variant: pickVariant(rec.telegramId, stage),
      decision,
    });
  }

  // Oldest stall first — the backlog drains in the order it accumulated.
  eligible.sort((a, b) => new Date(a.stalledAt) - new Date(b.stalledAt));
  return eligible.slice(0, cap);
}
```

- [ ] **Step 4: Write `artifacts.js`**

```javascript
// apps/web/src/lib/server/reengage/artifacts.js
/**
 * Build the per-person facts a nudge is allowed to quote.
 *
 * Everything here is either a real count from the database or absent. Absent
 * is safe: copy.mjs drops any line whose number is missing or zero rather than
 * rendering "0 people".
 *
 * Failure degrades rather than skips. A person whose artifact could not be
 * built still gets the baseline message — losing the nudge entirely would be a
 * worse outcome than losing the flourish.
 */
import { supabase } from '../db';
import { draftReply } from '../replyEngine';

const NINETY_DAYS_MS = 90 * 86400000;

/** Marketplace demand — the same signal the /start sell pitch already quotes. */
async function demandCounts(sb) {
  const since = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
  const [{ count: unanswered }, { count: waiting }] = await Promise.all([
    sb.from('search_logs').select('id', { count: 'exact', head: true }).eq('results_count', 0).gte('created_at', since),
    sb.from('search_waitlist').select('id', { count: 'exact', head: true }).is('notified_at', null),
  ]);
  return { unanswered: unanswered || 0, waiting: waiting || 0 };
}

/** What the assistant has actually learned, for the "ready and waiting" pitch. */
async function learnedCounts(sb, businessId) {
  const [{ count: products }, { count: facts }] = await Promise.all([
    sb.from('products').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
  ]);
  return { products: products || 0, factCount: facts || 0 };
}

export async function buildFacts({ stage, business, telegramId }) {
  const first = (business?.owner_name || '').split(' ')[0] || null;
  const base = {
    first,
    shop: business?.name || null,
    telegramId,
  };

  const sb = supabase();
  try {
    if (stage === 'A1' || stage === 'B1') {
      return { ...base, ...(await demandCounts(sb)) };
    }

    if (stage === 'B2' || stage === 'B3') {
      // The heaviest path in the system. Bounded by the caller's daily cap and
      // by this timeout; on failure we fall through to the baseline facts and
      // copy.mjs substitutes a generic example.
      // Synthetic customer + conversation with preview: true — the same shape
      // the /preview owner command uses at replyEngine.js:3596-3598, so no live
      // conversation or message row is ever written.
      const question = 'Do you deliver?';
      const syntheticCustomer = { id: null, name: 'Customer' };
      const syntheticConversation = { id: null, metadata: {} };
      const { draft } = await Promise.race([
        draftReply(business, syntheticCustomer, syntheticConversation, question, { isSecretary: false, preview: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('draft_timeout')), 20000)),
      ]);
      return { ...base, question, draft: draft || null };
    }

    if (stage === 'B4' && business?.id) {
      return { ...base, ...(await learnedCounts(sb, business.id)) };
    }
  } catch (e) {
    console.warn(`[reengage/artifacts] ${stage} artifact failed for ${telegramId}:`, e.message);
  }

  return base;
}
```

- [ ] **Step 5: Run tests and the build**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageAudience.test.mjs`
Expected: PASS, 8 tests.

Run: `cd apps/web && npm run build`
Expected: build succeeds — confirms the `.mjs` imports resolve under the Next bundler.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/reengage/audience.js apps/web/src/lib/server/reengage/artifacts.js apps/web/src/lib/server/__tests__/reengageAudience.test.mjs
git commit -m "Add re-engagement audience query and per-stage artifact building"
```

---

### Task 7: Sending, attribution, and the cron route

**Files:**
- Create: `apps/web/src/lib/server/reengage/send.js`
- Create: `apps/web/src/app/api/cron/reengagement/route.js`
- Delete: `apps/web/src/app/api/cron/onboarding-nudges/route.js`
- Modify: `apps/web/vercel.json` (swap the cron entry)
- Test: `apps/web/src/lib/server/__tests__/reengageSend.test.mjs`

**Interfaces:**
- Consumes: `renderMessage` from `./copy.mjs`, `loadCandidates` from `./audience.js`, `buildFacts` from `./artifacts.js`, `isCronAuthorized` from `../auth`, `audit` from `../audit`, `supabase()` from `../db`.
- Produces: `sendReengagement({ token, candidate, facts })` → `Promise<{ ok, status, recorded }>`; `GET /api/cron/reengagement` returning a summary object.

The old route is deleted rather than left in place — leaving both would double-message every stalled owner.

- [ ] **Step 1: Write the failing test**

```javascript
// apps/web/src/lib/server/__tests__/reengageSend.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const send  = readFileSync(`${root}apps/web/src/lib/server/reengage/send.js`, 'utf8');
const route = readFileSync(`${root}apps/web/src/app/api/cron/reengagement/route.js`, 'utf8');
const vercel = readFileSync(`${root}apps/web/vercel.json`, 'utf8');

test('the old nudge cron is gone, so nobody is messaged twice', () => {
  assert.ok(!existsSync(`${root}apps/web/src/app/api/cron/onboarding-nudges/route.js`));
  assert.ok(!/onboarding-nudges/.test(vercel), 'vercel.json still schedules the old cron');
});

test('the new cron is scheduled in the evening EAT, not mid-afternoon', () => {
  const cfg = JSON.parse(vercel);
  const cron = cfg.crons.find(c => c.path === '/api/cron/reengagement');
  assert.ok(cron, 'reengagement cron not registered');
  // 17:00 UTC = 20:00 EAT. 11:00 UTC (the old slot) was 2pm EAT, mid-trading.
  assert.equal(cron.schedule, '0 17 * * *');
});

test('the route refuses unauthorized callers', () => {
  assert.match(route, /isCronAuthorized/);
  assert.match(route, /401/);
});

test('dry run sends nothing', () => {
  assert.match(route, /dry_run/);
  assert.match(route, /if \(dryRun\)/);
});

test('a Telegram 403 permanently opts that person out', () => {
  assert.match(send, /403/);
  assert.match(send, /opted_out/);
});

test('every send is recorded for attribution before we can forget it', () => {
  assert.match(send, /reengagement_sends/);
  assert.match(send, /insert/);
  assert.match(send, /variant/);
  assert.match(send, /stage/);
});

test('one failed recipient never aborts the run', () => {
  assert.match(route, /try\s*\{/);
  assert.match(route, /catch/);
});

test('the run is audited, matching the cron it replaces', () => {
  assert.match(route, /audit\(/);
  assert.match(route, /reengagement\.run/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageSend.test.mjs`
Expected: FAIL — `ENOENT` for `reengage/send.js`.

- [ ] **Step 3: Write `send.js`**

```javascript
// apps/web/src/lib/server/reengage/send.js
/**
 * Deliver one re-engagement DM and record it.
 *
 * Recording is not optional bookkeeping: without a reengagement_sends row we
 * cannot tell a working message from a lucky one, and the send schedule in
 * eligibility.mjs reads these rows to know how many times we have already
 * asked. A send we fail to record is a send we may repeat.
 */
import { supabase } from '../db';
import { renderMessage } from './copy.mjs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || '').trim().replace(/\/$/, '');

/** Map a copy action to a Telegram inline-keyboard button. */
function toTelegramButton(btn) {
  if (btn.action.startsWith('exit:')) {
    return { text: btn.text, callback_data: `reengage_${btn.action}` };
  }
  if (btn.action === 'help_token') {
    return { text: btn.text, callback_data: 'reengage_help_token' };
  }
  const paths = {
    open_app: '', open_teach: '?step=teach', open_connect: '?step=connect', go_shared: '?step=connect&mode=shared',
  };
  const url = `${APP_URL}${paths[btn.action] ?? ''}`;
  return { text: btn.text, web_app: { url } };
}

export async function sendReengagement({ token, candidate, facts }) {
  const { telegramId, business, stage, variant, decision } = candidate;
  const message = renderMessage({ stage, variant, isFinal: decision.isFinal, facts });
  const chatId = business?.owner_private_chat_id || telegramId;

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message.text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: message.buttons.map(row => row.map(toTelegramButton)) },
    }),
    signal: AbortSignal.timeout(8000),
  });

  const sb = supabase();

  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    console.warn(`[reengage/send] ${telegramId} failed: ${r.status} ${body?.description || ''}`);
    // 403 means they blocked the bot. Honour that permanently.
    if (r.status === 403 && business?.id) {
      const prefs = business.notification_prefs || {};
      await sb.from('businesses').update({
        notification_prefs: {
          ...prefs,
          owner_nudges: {
            ...(prefs.owner_nudges || {}),
            opted_out: true,
            opted_out_reason: 'telegram_403',
            opted_out_at: new Date().toISOString(),
          },
        },
      }).eq('id', business.id).then(() => {}, () => {});
    }
    return { ok: false, status: r.status, recorded: false };
  }

  const { error } = await sb.from('reengagement_sends').insert({
    telegram_id: telegramId,
    business_id: business?.id || null,
    stage,
    variant,
  });
  if (error) console.warn(`[reengage/send] attribution write failed for ${telegramId}:`, error.message);

  return { ok: true, status: r.status, recorded: !error };
}
```

- [ ] **Step 4: Write the cron route**

```javascript
// apps/web/src/app/api/cron/reengagement/route.js
/**
 * Stage-aware signup re-engagement.
 *
 * Replaces /api/cron/onboarding-nudges, which could only see people who
 * already had a businesses row and said the same thing to all of them. This
 * route reads the whole funnel from onboarding_events, works out where each
 * person stalled, and sends copy built from what that person actually gave us.
 *
 * Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`.
 * Dry run: `?dry_run=1` reports stage and variant per candidate, sends nothing.
 * Schedule: registered in vercel.json (17:00 UTC = 20:00 EAT).
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { audit } from '../../../../lib/server/audit';
import { loadCandidates, DEFAULT_CAP } from '../../../../lib/server/reengage/audience';
import { buildFacts } from '../../../../lib/server/reengage/artifacts';
import { sendReengagement } from '../../../../lib/server/reengage/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'no_bot_token' }, { status: 500 });

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const now = Date.now();

  let candidates;
  try {
    candidates = await loadCandidates({ now, cap: DEFAULT_CAP });
  } catch (e) {
    console.error('[cron/reengagement] audience load failed:', e.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const summary = { eligible: candidates.length, sent: 0, failed: 0, cap: DEFAULT_CAP, dry_run: dryRun, by_stage: {} };
  for (const c of candidates) summary.by_stage[c.stage] = (summary.by_stage[c.stage] || 0) + 1;

  if (dryRun) {
    summary.sample = candidates.slice(0, 10).map(c => ({
      telegram_id: c.telegramId,
      stage: c.stage,
      variant: c.variant,
      is_final: c.decision.isFinal,
      stalled_at: c.stalledAt,
      shop: c.business?.name || null,
    }));
    return NextResponse.json({ ok: true, ...summary });
  }

  for (const c of candidates) {
    try {
      const facts = await buildFacts({ stage: c.stage, business: c.business, telegramId: c.telegramId });
      const r = await sendReengagement({ token, candidate: c, facts });
      if (r.ok) summary.sent++; else summary.failed++;
    } catch (e) {
      // One bad recipient must never take down the run.
      summary.failed++;
      console.warn(`[cron/reengagement] ${c.telegramId} errored:`, e.message);
    }
    await sleep(60); // stay under Telegram's rate limit
  }

  console.log('[cron/reengagement]', JSON.stringify(summary));

  if (summary.sent || summary.failed) {
    await audit({
      business_id: null,
      actor_type: 'system',
      actor_id: 'cron',
      action: 'reengagement.run',
      resource_type: 'cron',
      resource_id: null,
      metadata: summary,
      request,
    });
  }

  return NextResponse.json({ ok: true, ...summary });
}
```

- [ ] **Step 5: Swap the cron registration and delete the old route**

In `apps/web/vercel.json`, replace the line:

```json
    { "path": "/api/cron/onboarding-nudges",   "schedule": "0 11 * * *" },
```

with:

```json
    { "path": "/api/cron/reengagement",        "schedule": "0 17 * * *" },
```

Then delete the old route:

```bash
git rm apps/web/src/app/api/cron/onboarding-nudges/route.js
```

- [ ] **Step 6: Run tests and the build**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageSend.test.mjs`
Expected: PASS, 8 tests.

Run: `cd apps/web && npm test`
Expected: the whole suite passes, including the pre-existing tests.

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/server/reengage/send.js apps/web/src/app/api/cron/reengagement/route.js apps/web/vercel.json apps/web/src/lib/server/__tests__/reengageSend.test.mjs
git commit -m "Replace the generic onboarding nudge with a stage-aware re-engagement cron"
```

---

### Task 8: The reply path and outcome attribution

**Files:**
- Modify: `apps/web/src/app/api/agent-bot/webhook/route.js` (add a branch before the unknown-user fallback at ~line 1088; add a `reengage_` callback handler)
- Create: `apps/web/src/lib/server/reengage/outcomes.js`
- Modify: `apps/web/src/app/api/cron/reengagement/route.js` (call the outcome sweep)
- Test: `apps/web/src/lib/server/__tests__/reengageReply.test.mjs`

**Interfaces:**
- Consumes: `supabase()` from `../db`, `detectStage`/`STAGES` from `./stages.mjs`.
- Produces: `resolveOutcomes({ now })` → `Promise<{ checked, advanced }>`; `recentReengagementSend(telegramId)` → `Promise<row|null>`.

Without this task the engine sends enticing messages and then deflects the replies they generate with a canned button, and never learns whether any of it worked.

- [ ] **Step 1: Write the failing test**

```javascript
// apps/web/src/lib/server/__tests__/reengageReply.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const webhook  = readFileSync(`${root}apps/web/src/app/api/agent-bot/webhook/route.js`, 'utf8');
const outcomes = readFileSync(`${root}apps/web/src/lib/server/reengage/outcomes.js`, 'utf8');
const route    = readFileSync(`${root}apps/web/src/app/api/cron/reengagement/route.js`, 'utf8');

test('a reply to a nudge is handled before the unknown-user brush-off', () => {
  const replyIdx   = webhook.indexOf('recentReengagementSend');
  const unknownIdx = webhook.indexOf('Unknown user');
  assert.ok(replyIdx > -1, 'no re-engagement reply branch');
  assert.ok(replyIdx < unknownIdx, 'the branch must run before the unknown-user fallback');
});

test('replying is recorded, so reply rate is measurable per variant', () => {
  assert.match(webhook, /replied_at/);
});

test('the exit-question chips are handled and their reason stored', () => {
  assert.match(webhook, /reengage_exit:/);
  assert.match(webhook, /exit_reason/);
});

test('outcomes are resolved by comparing stage now against stage at send time', () => {
  assert.match(outcomes, /detectStage/);
  assert.match(outcomes, /advanced/);
});

test('only unresolved sends old enough to judge are swept', () => {
  assert.match(outcomes, /outcome/);
  assert.match(outcomes, /is\(['"]outcome['"],\s*null\)/);
});

test('the cron actually runs the sweep, or attribution never resolves', () => {
  assert.match(route, /resolveOutcomes/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageReply.test.mjs`
Expected: FAIL — `ENOENT` for `reengage/outcomes.js`.

- [ ] **Step 3: Write `outcomes.js`**

```javascript
// apps/web/src/lib/server/reengage/outcomes.js
/**
 * Did the nudge work?
 *
 * A send is resolved by re-deriving the person's stage today and comparing it
 * to the stage recorded when we messaged them. Advancing any rung counts;
 * reaching a connected state counts as completed. Without this sweep the
 * attribution table records only that we sent something, which answers nothing.
 */
import { supabase } from '../db';
import { detectStage, STAGES } from './stages.mjs';

const RESOLVE_AFTER_MS = 7 * 86400000;

export async function recentReengagementSend(telegramId) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data } = await supabase()
    .from('reengagement_sends')
    .select('id, telegram_id, business_id, stage, variant, sent_at, replied_at')
    .eq('telegram_id', telegramId)
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

export async function resolveOutcomes({ now = Date.now() } = {}) {
  const sb = supabase();
  const cutoff = new Date(now - RESOLVE_AFTER_MS).toISOString();

  const { data: pending } = await sb
    .from('reengagement_sends')
    .select('id, telegram_id, stage, sent_at')
    .is('outcome', null)
    .lte('sent_at', cutoff)
    .limit(500);
  if (!pending?.length) return { checked: 0, advanced: 0 };

  const ids = pending.map(p => p.telegram_id);

  const { data: events } = await sb
    .from('onboarding_events')
    .select('telegram_id, step')
    .in('telegram_id', ids);
  const stepsByUser = new Map();
  for (const e of events || []) {
    const key = String(e.telegram_id);
    if (!stepsByUser.has(key)) stepsByUser.set(key, []);
    stepsByUser.get(key).push(e.step);
  }

  const { data: businesses } = await sb
    .from('businesses')
    .select('id, owner_telegram_id, onboarding_completed, telegram_bot_username')
    .in('owner_telegram_id', ids);
  const bizByOwner = new Map((businesses || []).map(b => [String(b.owner_telegram_id), b]));

  let advanced = 0;
  for (const row of pending) {
    const key = String(row.telegram_id);
    const business = bizByOwner.get(key) || null;
    const nowStage = detectStage({ steps: stepsByUser.get(key) || [], business });

    // detectStage returns null once they are live — that is the win condition.
    let outcome = 'no_change';
    if (nowStage === null) outcome = 'completed';
    else if (STAGES.indexOf(nowStage) > STAGES.indexOf(row.stage)) outcome = 'advanced';

    if (outcome !== 'no_change') advanced++;
    await sb.from('reengagement_sends').update({ outcome }).eq('id', row.id).then(() => {}, () => {});
  }

  return { checked: pending.length, advanced };
}
```

- [ ] **Step 4: Wire the sweep into the cron**

In `src/app/api/cron/reengagement/route.js`, add the import beside the others:

```javascript
import { resolveOutcomes } from '../../../../lib/server/reengage/outcomes';
```

Then, immediately before the `console.log('[cron/reengagement]', ...)` line, add:

```javascript
  // Resolve last week's sends before reporting — cheap, and it is the only
  // thing that turns the attribution table into an answer.
  if (!dryRun) {
    try {
      summary.outcomes = await resolveOutcomes({ now });
    } catch (e) {
      console.warn('[cron/reengagement] outcome sweep failed:', e.message);
    }
  }
```

- [ ] **Step 5: Add the reply branch to the agent-bot webhook**

In `src/app/api/agent-bot/webhook/route.js`, add the import beside the other server-lib imports at the top:

```javascript
import { recentReengagementSend } from '../../../../lib/server/reengage/outcomes';
```

Immediately **before** the `// ── Step 5: Unknown user` block (near line 1088), insert:

```javascript
    // ── Re-engagement reply ────────────────────────────────────────────────
    // We DM stalled signups something specific about their own setup. If they
    // answer, they must reach something that can actually help — deflecting a
    // genuine reply with a canned button is what kills the whole exercise.
    // Reopening the mini-app is the friction that lost them in the first place.
    const reengaged = await recentReengagementSend(String(msg.from.id));
    if (reengaged) {
      if (!reengaged.replied_at) {
        await supabase().from('reengagement_sends')
          .update({ replied_at: new Date().toISOString() })
          .eq('id', reengaged.id)
          .then(() => {}, () => {});
      }
      const ownerBiz = reengaged.business_id ? await findById(reengaged.business_id) : null;
      if (ownerBiz) {
        // They have a shop on file — let the brain answer with full context.
        await handleTenantUpdate(ownerBiz, AGENT_TOKEN, update);
        return NextResponse.json({ ok: true });
      }
      // No shop yet: answer the question, then offer the one-tap way in.
      await tg('sendMessage', {
        chat_id: chatId,
        parse_mode: 'Markdown',
        text:
          `Good question — happy to help 👋\n\n` +
          `MiniMe answers your customers on Telegram in your voice, 24/7, in Amharic and English. ` +
          `Setting up your shop takes about a minute and costs nothing to list.\n\n` +
          `ማንኛውም ጥያቄ ካለዎት ይጻፉልኝ።`,
        reply_markup: { inline_keyboard: [[{ text: '📱 Set up my shop — 1 min', web_app: { url: MINIAPP_BASE } }]] },
      });
      return NextResponse.json({ ok: true });
    }
```

- [ ] **Step 6: Handle the exit-question chips**

In the same file, find the `callback_query` handling block (the one containing the existing `deleteSignupSession(cbUserId)` call near line 727) and add a handler at the start of its dispatch:

```javascript
      // Exit-question chips from the final re-engagement nudge. This is the
      // only place we learn WHY the funnel leaks, so record it and thank them.
      if (typeof cbData === 'string' && cbData.startsWith('reengage_exit:')) {
        const reason = cbData.slice('reengage_exit:'.length);
        const recent = await recentReengagementSend(String(cbUserId));
        if (recent) {
          await supabase().from('reengagement_sends')
            .update({ exit_reason: reason, replied_at: new Date().toISOString() })
            .eq('id', recent.id)
            .then(() => {}, () => {});
        }
        await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Thank you 🙏' });
        await tg('sendMessage', {
          chat_id: cbChatId,
          text: 'Thank you — that genuinely helps. If you ever want to pick it back up, just message me.\n\nአመሰግናለሁ 🙏',
        });
        return NextResponse.json({ ok: true });
      }

      if (cbData === 'reengage_help_token') {
        await tg('answerCallbackQuery', { callback_query_id: cb.id });
        await tg('sendMessage', {
          chat_id: cbChatId,
          parse_mode: 'Markdown',
          text:
            `No problem — here's the short version:\n\n` +
            `1. Open @BotFather\n2. Send /newbot\n3. Pick a name and a username ending in \`bot\`\n` +
            `4. Copy the token it gives you\n5. Paste it in MiniMe\n\n` +
            `Stuck on any step? Just tell me which one.`,
          reply_markup: { inline_keyboard: [[{ text: '📱 Open MiniMe', web_app: { url: MINIAPP_BASE } }]] },
        });
        return NextResponse.json({ ok: true });
      }
```

Before writing this, confirm the local variable names in that block — the plan assumes `cb`, `cbData`, `cbUserId`, and `cbChatId`. Run `sed -n '700,740p' src/app/api/agent-bot/webhook/route.js` and use whatever names are actually in scope. Likewise confirm that `findById`, `handleTenantUpdate`, `AGENT_TOKEN`, `MINIAPP_BASE`, `tg`, and `supabase` are already imported in this file; import any that are not.

- [ ] **Step 7: Run tests and the build**

Run: `cd apps/web && node --test src/lib/server/__tests__/reengageReply.test.mjs`
Expected: PASS, 6 tests.

Run: `cd apps/web && npm test`
Expected: full suite passes.

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/server/reengage/outcomes.js apps/web/src/app/api/agent-bot/webhook/route.js apps/web/src/app/api/cron/reengagement/route.js apps/web/src/lib/server/__tests__/reengageReply.test.mjs
git commit -m "Make nudge replies land somewhere useful and resolve send outcomes"
```

---

### Task 9: Pre-flight verification against production data

**Files:** none modified. This task is verification only.

**Interfaces:**
- Consumes: the deployed `/api/cron/reengagement` endpoint.
- Produces: a go/no-go decision on the first real send.

Nothing in Tasks 1–8 proves the stage distribution is sane against real data. A copy or stage bug found here costs nothing; found after a send it costs the dormant list.

- [ ] **Step 1: Apply the migration**

Run migration `packages/db/migrations/039_reengagement_sends.sql` in the Supabase SQL editor for project `hbmesjhkczhqpbdseifd`, following the project's existing migration practice.

- [ ] **Step 2: Deploy the branch as a preview**

Deploy `reengagement-spec` to a Vercel preview. Do not promote to production yet.

- [ ] **Step 3: Dry-run against real data**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://<preview-url>/api/cron/reengagement?dry_run=1" | jq
```

Check, and stop if any of these look wrong:
- `by_stage` — is the distribution plausible? A population that is 100% one stage means stage detection is broken.
- `eligible` vs `cap` — eligible should be capped at 50.
- `sample[].variant` — both `demand` and `payoff` should appear.
- `sample[].shop` — real shop names, not `null` everywhere for B2+ stages.

- [ ] **Step 4: Have the Amharic reviewed**

Before any real send, have a native Amharic speaker read the rendered messages for all six stages plus the exit question. The spec flags this explicitly: tone in sales copy is exactly where machine-adjacent translation goes subtly wrong. Fix and commit any corrections to `copy.mjs`.

- [ ] **Step 5: Send to yourself first**

Temporarily set `ADMIN_TELEGRAM_IDS` to exclude your own id (admins are suppressed by design), trigger one real run with `REENGAGE_DAILY_CAP=1`, and confirm the DM arrives, renders correctly with no raw Markdown artifacts, and that its buttons work. Restore `ADMIN_TELEGRAM_IDS` afterwards.

- [ ] **Step 6: Confirm the reply path**

Reply to the DM you received with a plain question such as "how much does it cost?". Confirm you get a real answer rather than the unknown-user button, and that `reengagement_sends.replied_at` is now set for that row.

- [ ] **Step 7: Commit any fixes and open the PR**

```bash
git add -A
git commit -m "Fix issues found in pre-flight verification"
gh pr create --base main --title "Stage-aware signup re-engagement engine" --body "$(cat <<'EOF'
Replaces the single generic onboarding nudge with a stage-aware engine.

The old cron could only see people who already had a businesses row, and sent
everyone the same "we fixed a bug, tap Go Live again" message. This reads the
whole funnel from onboarding_events, works out where each person actually
stalled, and sends bilingual copy built from what that person gave us.

- Six-stage ladder, A1 (tapped Sell, no account) through B5 (stuck at BotFather)
- B5 offers shared mode as an escape hatch instead of repeating the instruction
  that already failed
- Replies now reach the brain instead of a canned button
- reengagement_sends records stage, variant, reply, exit reason, and outcome
- Capped at 50/day oldest-first, 3 sends per person, evening EAT
- Repairs two telemetry paths the ladder depends on: dropped tour_* steps and
  the funnel_events writes that silently no-op

Spec: docs/superpowers/specs/2026-08-08-signup-reengagement-design.md
Plan: docs/superpowers/plans/2026-08-08-signup-reengagement.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

**Spec coverage.** Every spec section maps to a task: stage ladder → 3; telemetry repairs → 2; architecture/module split → 3–7; cadence and caps → 4, 6, 7; bilingual messaging and the appendix copy → 5; exit question → 5, 8; reply path → 8; suppression and consent → 4, 6; attribution → 1, 7, 8; error handling → 6, 7; testing → every task; out-of-scope items are absent by construction.

**Deliberate deviations from the spec.** The spec named the modules `stages.js`, `audience.js`, `artifacts.js`, `copy.js`, `send.js`. The pure ones are `.mjs` here because `node --test` cannot import extensionless specifiers — the spec's testing section demands real unit tests for exactly those modules, and `.mjs` is the existing pattern in this codebase. `eligibility.mjs` was split out of `audience.js` for the same reason: cooldown and cap logic is the highest-value thing to test and the least testable if buried next to database calls.

**Assumptions verified while writing this plan, so the implementer inherits facts rather than guesses.**

- `draftReply(business, customer, conversation, incomingText, options)` returns `{ draft, confidence, ... }` (`replyEngine.js:1750`). Task 6 uses the synthetic-customer preview shape proven at `replyEngine.js:3596-3598`.
- `products.business_id` exists (`schema.sql:132`); `documents` is queried with `business_id` across several admin routes, so the B4 counts are sound.
- `businesses.id` is `UUID` (`schema.sql:12`), matching the migration's FK type.
- `STOP` / `/stop_nudges` already flips `notification_prefs.owner_nudges.opted_out` (`agent-bot/webhook/route.js:835-846`), so the opt-out promise in the copy is honoured today and needs no new work.

**Assumption still left to the implementer.** Task 8 Step 6 must confirm the callback-handler variable names (`cb`, `cbData`, `cbUserId`, `cbChatId`) actually in scope in the webhook's `callback_query` block, since the plan reads them from a region of a ~1,200-line file that may drift.
