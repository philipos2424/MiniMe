# Metric Truth (Admin Rebuild, Sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every admin number trustworthy: stop the billing sync from stripping new shops' trials, repair the shops it already hit, and build nightly per-shop and platform daily rollups that later dashboard sections read.

**Architecture:** Pure, dependency-free `.mjs` modules hold all metric definitions and aggregation (`lib/server/metrics/`), unit-tested with `node --test`. One cron route fetches a rolling window from Supabase, calls the pure builders, and upserts `shop_daily` / `platform_daily`, logging each run to `metrics_rollup_runs`. First run with an empty `platform_daily` backfills automatically.

**Tech Stack:** Next.js App Router route handlers (Node runtime), Supabase JS (service role), Postgres, `node:test`, Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-10-13-admin-dashboard-rebuild-design.md`

## Global Constraints

- Day = East Africa Time: use `dayKeyEAT` from `lib/server/fetch-all.mjs`; never `toISOString().slice(0,10)` on raw timestamps.
- Internal shops (`businesses.is_internal = true`) are excluded from every metric; a `null`/`false` value means external.
- Rollup tables hold no personal data: ids, day, counts, states only. No names, phones, handles, telegram ids, or message text.
- `shop_daily` has **no** foreign key to `businesses` (owner erasure re-keys rows to a random UUID — spec §5).
- LLM metrics count chain calls only: rows whose `route` starts with `raw:` are excluded (matches Pulse).
- Every Supabase list read goes through `fetchAllRows` with a stable `.order()` (1000-row cap).
- Cron routes: `isCronAuthorized(request)`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 300`.
- Commit only the files a task names — the working tree has unrelated uncommitted user changes (`openaiClient.js`, three test files, `providerCompletion.test.mjs`) that must not be staged.
- Tests: `cd apps/web && node --test src/lib/server/__tests__/<file>.test.mjs`.

## Review Focus

1. A message whose `business_id` is not in the fetched businesses (deleted shop) — must be skipped, not written (no FK would stop it). Test in Task 5.
2. An event at 21:30 UTC belongs to the next EAT day. Test in Task 4.
3. Running the cron twice yields identical rows — builders must be deterministic and sorted. Test in Task 5.
4. A day with zero activity still produces a `platform_daily` row of zeros, and the today snapshot still writes plan state for every external shop. Test in Task 5.
5. Messages with `conversation_id` null or a reply arriving before any inbound — latency must ignore them without throwing. Test in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/lib/paymentState.js` (modify) | Align null-expiry rule with `planStatus` |
| `apps/web/src/lib/server/billing.js` (modify) | Stop writing `subscription_status`/`plan_tier` on credit deduction |
| `apps/web/src/app/api/admin/businesses/[id]/route.js` (modify) | Allow toggling `is_internal` |
| `packages/db/migrations/060_metrics_rollup.sql` (create) | `is_internal`, `shop_daily`, `platform_daily`, `metrics_rollup_runs` |
| `packages/db/migrations/061_repair_trial_status_sync.sql` (create) | Restore stripped trials |
| `apps/web/src/lib/server/metrics/definitions.mjs` (create) | Every metric definition |
| `apps/web/src/lib/server/metrics/rollup.mjs` (create) | Pure row builders |
| `apps/web/src/app/api/cron/metrics-rollup/route.js` (create) | Fetch → build → upsert → log |
| `apps/web/vercel.json` (modify) | Schedule cron 23:00 UTC (02:00 EAT) |
| `apps/web/src/lib/server/__tests__/metricTruthGuards.test.mjs` (create) | Billing/paymentState/PATCH/cron shape guards |
| `apps/web/src/lib/server/__tests__/metricsDefinitions.test.mjs` (create) | Definitions tests |
| `apps/web/src/lib/server/__tests__/metricsRollup.test.mjs` (create) | Builder tests |

---

### Task 1: Stop the billing sync and align `paymentState`

**Files:**
- Modify: `apps/web/src/lib/server/billing.js` (block `// Synchronize business table plan details`, ~line 192)
- Modify: `apps/web/src/lib/paymentState.js:53-55`
- Test: `apps/web/src/lib/server/__tests__/metricTruthGuards.test.mjs`

**Interfaces:**
- Produces: `paymentState(business)` returns `'free'`/`'interested'`/`'expired'` (never `'granted'`) for `status='active'` with null expiry and non-pro tier.

- [ ] **Step 1: Write the failing tests**

```js
/**
 * Guards for the admin metric-truth work.
 *
 * deductCreditAndLogUsage once copied subscriptions.status (column default
 * 'active') onto businesses.subscription_status on every AI reply. planStatus()
 * reads active-with-no-expiry as NOT Pro, so every new shop lost its trial on
 * its first AI reply, while paymentState() (still honouring null expiry)
 * labelled the same shop "granted" on the admin page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paymentState } from '../../paymentState.js';
import { planStatus } from '../../plan.js';

const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const future = d => new Date(Date.now() + d * 86400000).toISOString();

test('credit deduction never writes plan state onto businesses', () => {
  const src = stripComments(read('lib/server/billing.js'));
  const start = src.indexOf('export async function deductCreditAndLogUsage');
  const end = src.indexOf('export ', start + 10);
  const fn = src.slice(start, end);
  assert.ok(start >= 0, 'deductCreditAndLogUsage must exist');
  assert.ok(!/from\('businesses'\)/.test(fn), 'deductCreditAndLogUsage must not touch businesses');
});

test('paymentState agrees with planStatus: active + null expiry is not Pro', () => {
  const b = { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: null, trial_ends_at: future(10) };
  assert.equal(planStatus(b).isPro, false);
  assert.notEqual(paymentState(b), 'granted');
});

test('paymentState still reports a dated active grant as granted', () => {
  const b = { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: future(5) };
  assert.equal(paymentState(b), 'granted');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && node --test src/lib/server/__tests__/metricTruthGuards.test.mjs`
Expected: FAIL on "never writes plan state" and "agrees with planStatus".

- [ ] **Step 3: Implement**

In `billing.js`, delete the whole block:

```js
    // Synchronize business table plan details
    await sb
      .from('businesses')
      .update({
        plan_tier: sub.plan_name,
        subscription_status: sub.status,
      })
      .eq('id', businessId);
```

and put in its place:

```js
    // Deliberately no write to businesses here. This once copied
    // subscriptions.status (column default 'active') onto
    // businesses.subscription_status on every AI reply, which planStatus()
    // reads as "no trial, no Pro" — every new shop lost its trial on its first
    // customer reply. Entitlement is owned by the payment/admin paths only.
```

In `paymentState.js` replace

```js
  const hasProAccess = tier === 'pro'
    || (status === 'active' && (!expiresAt || expiresAt > now))
    || onTrial;
```

with

```js
  // Same rule as planStatus(): an active status with no end date is not a
  // subscription. Honouring it here labelled trial shops broken by the old
  // billing sync as "granted" while planStatus() denied them Pro.
  const hasProAccess = tier === 'pro'
    || (status === 'active' && expiresAt > now)
    || onTrial;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && node --test src/lib/server/__tests__/metricTruthGuards.test.mjs src/lib/server/__tests__/*.test.mjs`
Expected: all PASS (whole suite, to catch a test that relied on the old rule).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/billing.js apps/web/src/lib/paymentState.js apps/web/src/lib/server/__tests__/metricTruthGuards.test.mjs
git commit -m "fix(billing): stop credit use from stripping new shops' trials"
```

---

### Task 2: Rollup schema + `is_internal`

**Files:**
- Create: `packages/db/migrations/060_metrics_rollup.sql`
- Modify: `apps/web/src/app/api/admin/businesses/[id]/route.js` (PATCH allowlist)
- Test: `apps/web/src/lib/server/__tests__/metricTruthGuards.test.mjs` (append)

**Interfaces:**
- Produces: tables `shop_daily`, `platform_daily`, `metrics_rollup_runs`; column `businesses.is_internal`; PATCH body `{ is_internal: boolean }`.

- [ ] **Step 1: Append failing test**

```js
test('admin PATCH can mark a shop internal', () => {
  const src = stripComments(read('app/api/admin/businesses/[id]/route.js'));
  assert.match(src, /'is_internal' in body\)\s*updates\.is_internal\s*=\s*!!body\.is_internal/);
});

test('migration 060 creates rollup tables without a businesses FK on shop_daily', () => {
  const sql = readFileSync(new URL('../../../../../../packages/db/migrations/060_metrics_rollup.sql', import.meta.url), 'utf8');
  for (const t of ['shop_daily', 'platform_daily', 'metrics_rollup_runs']) assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
  assert.match(sql, /add column if not exists is_internal boolean not null default false/);
  const shopDaily = sql.slice(sql.indexOf('public.shop_daily'), sql.indexOf('public.platform_daily'));
  assert.ok(!/references/i.test(shopDaily), 'shop_daily must not FK businesses (erasure re-keys rows)');
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL (file missing / regex no match).

- [ ] **Step 3: Write migration**

```sql
-- 060_metrics_rollup.sql — nightly admin rollups (spec 2026-10-13 §3.2).
-- Counts and states only; no personal data. shop_daily has no FK to
-- businesses on purpose: owner erasure re-keys rows to a random UUID so
-- platform totals survive while the link to the person is removed.

alter table public.businesses
  add column if not exists is_internal boolean not null default false;

create table if not exists public.shop_daily (
  business_id           uuid        not null,
  day                   date        not null,
  inbound_messages      int         not null default 0,
  outbound_messages     int         not null default 0,
  failed_messages       int         not null default 0,
  ai_messages           int         not null default 0,
  customers_active      int         not null default 0,
  customers_new         int         not null default 0,
  orders_created        int         not null default 0,
  orders_paid           int         not null default 0,
  paid_order_value_etb  numeric(14,2) not null default 0,
  first_reply_p50_s     int,
  owner_sessions        int         not null default 0,
  llm_calls             int         not null default 0,
  llm_failed            int         not null default 0,
  llm_cost_usd          numeric(12,6) not null default 0,
  ai_tokens             bigint      not null default 0,
  plan_state            text,
  payment_state         text,
  source                text        not null default 'cron' check (source in ('cron','backfill')),
  computed_at           timestamptz not null default now(),
  primary key (business_id, day)
);
create index if not exists shop_daily_day_idx on public.shop_daily (day);

create table if not exists public.platform_daily (
  day                date        primary key,
  signups            int         not null default 0,
  live_shops         int         not null default 0,
  engaged_owners     int         not null default 0,
  inbound_messages   int         not null default 0,
  outbound_messages  int         not null default 0,
  failed_messages    int         not null default 0,
  orders_created     int         not null default 0,
  orders_paid        int         not null default 0,
  llm_calls          int         not null default 0,
  llm_failed         int         not null default 0,
  llm_cost_usd       numeric(12,6) not null default 0,
  trial_converted    int         not null default 0,
  subscribed         int         not null default 0,
  expired            int         not null default 0,
  funnel             jsonb       not null default '{}'::jsonb,
  source             text        not null default 'cron' check (source in ('cron','backfill')),
  computed_at        timestamptz not null default now()
);

create table if not exists public.metrics_rollup_runs (
  id            bigserial   primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  days_from     date,
  days_to       date,
  shop_rows     int,
  platform_rows int,
  ok            boolean,
  error         text
);
create index if not exists metrics_rollup_runs_started_idx on public.metrics_rollup_runs (started_at desc);

-- Service role only (it bypasses RLS); no anon/authenticated access.
alter table public.shop_daily          enable row level security;
alter table public.platform_daily      enable row level security;
alter table public.metrics_rollup_runs enable row level security;
```

In `[id]/route.js` PATCH, after the `b2b_discoverable` line add:

```js
    if ('is_internal' in body)    updates.is_internal  = !!body.is_internal;
```

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Apply migration** via Supabase MCP `apply_migration` (project `hbmesjhkczhqpbdseifd`, name `060_metrics_rollup`, the SQL above). Verify: `select count(*) from shop_daily;` returns 0 and `select is_internal from businesses limit 1;` works.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/060_metrics_rollup.sql "apps/web/src/app/api/admin/businesses/[id]/route.js" apps/web/src/lib/server/__tests__/metricTruthGuards.test.mjs
git commit -m "feat(metrics): rollup tables and internal-shop flag"
```

---

### Task 3: Metric definitions

**Files:**
- Create: `apps/web/src/lib/server/metrics/definitions.mjs`
- Test: `apps/web/src/lib/server/__tests__/metricsDefinitions.test.mjs`

**Interfaces:**
- Produces: `dayKeyEAT(ts) → 'YYYY-MM-DD'|null`, `RECOMPUTE_DAYS=3`, `MAX_BACKFILL_DAYS=400`, `STALE_AFTER_HOURS=26`, `FUNNEL_STEPS: string[]`, `funnelStep(step) → string|null`, `isInternal(b) → boolean`, `isChainCall(row) → boolean`, `planState(b) → 'trial'|'pro'|'expired'|'free'`, `paymentState` (re-export), `median(nums) → number|null`, `eatMidnightIso(dayKey) → ISO string`.

- [ ] **Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKeyEAT, funnelStep, FUNNEL_STEPS, isInternal, isChainCall, planState, median, eatMidnightIso,
} from '../metrics/definitions.mjs';

const future = d => new Date(Date.now() + d * 86400000).toISOString();
const past = d => new Date(Date.now() - d * 86400000).toISOString();

test('21:30 UTC belongs to the next EAT day', () => {
  assert.equal(dayKeyEAT('2026-10-12T21:30:00Z'), '2026-10-13');
  assert.equal(dayKeyEAT('2026-10-12T20:59:59Z'), '2026-10-12');
});

test('eatMidnightIso is 21:00 UTC the previous day', () => {
  assert.equal(eatMidnightIso('2026-10-13'), '2026-10-12T21:00:00.000Z');
});

test('isInternal is true only for an explicit true', () => {
  assert.equal(isInternal({ is_internal: true }), true);
  assert.equal(isInternal({ is_internal: false }), false);
  assert.equal(isInternal({ is_internal: null }), false);
  assert.equal(isInternal({}), false);
});

test('raw provider rows are not chain calls', () => {
  assert.equal(isChainCall({ route: 'raw:openai' }), false);
  assert.equal(isChainCall({ route: 'reply' }), true);
  assert.equal(isChainCall({ route: null }), true);
});

test('funnel steps map aliases and drop unknowns', () => {
  assert.equal(funnelStep('connected_shared'), 'connected');
  assert.equal(funnelStep('connected_custom'), 'connected');
  assert.equal(funnelStep('welcome'), 'welcome');
  assert.equal(funnelStep('tour_started'), null);
  assert.ok(FUNNEL_STEPS.indexOf('welcome') < FUNNEL_STEPS.indexOf('trial_started'));
});

test('planState follows planStatus', () => {
  assert.equal(planState({ subscription_status: 'trial', trial_ends_at: future(5) }), 'trial');
  assert.equal(planState({ plan_tier: 'pro', subscription_status: 'active' }), 'pro');
  assert.equal(planState({ subscription_status: 'active', subscription_expires_at: future(5) }), 'pro');
  assert.equal(planState({ subscription_status: 'trial', trial_ends_at: past(1) }), 'expired');
  assert.equal(planState({ subscription_status: 'active', subscription_expires_at: null }), 'free');
});

test('median', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 9, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 3); // upper-middle, integer seconds
});
```

- [ ] **Step 2: Run to verify failure** — `node --test src/lib/server/__tests__/metricsDefinitions.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
/**
 * Admin metric definitions — the ONLY place a metric is defined.
 *
 * Both the nightly rollup (cron/metrics-rollup) and later live "today"
 * queries import from here, so the same word can never mean two things on
 * two screens again (spec 2026-10-13 §3.1). Pure and dependency-free so it
 * runs under plain `node --test`.
 */
import { dayKeyEAT } from '../fetch-all.mjs';
import { planStatus } from '../../plan.js';
import { paymentState } from '../../paymentState.js';

export { dayKeyEAT, paymentState };

/** Nightly recompute window — late payments/approvals land on the right day. */
export const RECOMPUTE_DAYS = 3;
/** First-run backfill depth. Messages older than 18 months are archived anyway. */
export const MAX_BACKFILL_DAYS = 400;
/** No successful run within this many hours = stale dashboard, alert. */
export const STALE_AFTER_HOURS = 26;

/** Owner onboarding funnel, in order. Counts are distinct telegram ids per day. */
export const FUNNEL_STEPS = [
  'welcome', 'signup', 'shop_name', 'shop_name_saved',
  'customer_chat_started', 'customer_chat_finished',
  'connect', 'connected', 'trial_started',
];
const STEP_ALIASES = { connected_shared: 'connected', connected_custom: 'connected' };

export function funnelStep(step) {
  const s = STEP_ALIASES[step] || step;
  return FUNNEL_STEPS.includes(s) ? s : null;
}

/** Test/demo shops. Only an explicit true counts — null is a real shop. */
export function isInternal(business) {
  return business?.is_internal === true;
}

/** llm_call_log: raw:* rows are per-provider attempts, not chain outcomes. */
export function isChainCall(row) {
  return !String(row?.route || '').startsWith('raw:');
}

/** Entitlement bucket, straight from planStatus() — never re-derived. */
export function planState(business) {
  const p = planStatus(business);
  if (p.onTrial) return 'trial';
  if (p.isPro) return 'pro';
  if (p.expired) return 'expired';
  return 'free';
}

/** Upper-middle median, rounded to an integer; null for no data. */
export function median(nums) {
  const xs = (nums || []).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  return Math.round(xs[Math.floor(xs.length / 2)]);
}

/** Start of an EAT day as a UTC ISO string (EAT = UTC+3, no DST). */
export function eatMidnightIso(dayKey) {
  return new Date(`${dayKey}T00:00:00+03:00`).toISOString();
}
```

- [ ] **Step 4: Run to verify pass** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/metrics/definitions.mjs apps/web/src/lib/server/__tests__/metricsDefinitions.test.mjs
git commit -m "feat(metrics): single module for admin metric definitions"
```

---

### Task 4: Rollup builders

**Files:**
- Create: `apps/web/src/lib/server/metrics/rollup.mjs`
- Test: `apps/web/src/lib/server/__tests__/metricsRollup.test.mjs`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces:
  - `replyLatencies(messages) → [{ business_id, inbound_at, latency_s }]`
  - `buildShopDailyRows({ days, todayKey, businesses, messages, customers, orders, llmCalls, aiUsage, uxEvents, source, computedAt }) → shop_daily rows[]` sorted by `business_id, day`
  - `buildPlatformDailyRows({ days, shopRows, businesses, onboardingEvents, subscriptionEvents, source, computedAt }) → platform_daily rows[]` sorted by `day`

- [ ] **Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShopDailyRows, buildPlatformDailyRows, replyLatencies } from '../metrics/rollup.mjs';

const future = d => new Date(Date.now() + d * 86400000).toISOString();
const DAYS = ['2026-10-11', '2026-10-12'];
const TODAY = '2026-10-12';
const AT = '2026-10-13T00:00:00.000Z';
const A = { id: 'a', created_at: '2026-10-11T08:00:00Z', subscription_status: 'trial', trial_ends_at: future(10), owner_telegram_id: 1 };
const INTERNAL = { id: 'i', created_at: '2026-10-11T08:00:00Z', is_internal: true, owner_telegram_id: 9 };

const msgs = [
  { business_id: 'a', conversation_id: 'c1', customer_id: 'u1', direction: 'inbound',  status: 'sent',   created_at: '2026-10-12T06:00:00Z' },
  { business_id: 'a', conversation_id: 'c1', customer_id: 'u1', direction: 'inbound',  status: 'sent',   created_at: '2026-10-12T06:00:30Z' },
  { business_id: 'a', conversation_id: 'c1', customer_id: 'u1', direction: 'outbound', status: 'sent',   created_at: '2026-10-12T06:01:00Z', is_ai_generated: true },
  { business_id: 'a', conversation_id: 'c1', customer_id: 'u1', direction: 'outbound', status: 'failed', created_at: '2026-10-12T06:02:00Z' },
  { business_id: 'a', conversation_id: null, customer_id: 'u2', direction: 'inbound',  status: 'sent',   created_at: '2026-10-12T07:00:00Z' },
  { business_id: 'gone', conversation_id: 'c9', direction: 'inbound', status: 'sent', created_at: '2026-10-12T06:00:00Z' },
  { business_id: 'i', conversation_id: 'c8', direction: 'inbound', status: 'sent', created_at: '2026-10-12T06:00:00Z' },
];

const input = (over = {}) => ({
  days: DAYS, todayKey: TODAY, businesses: [A, INTERNAL], messages: msgs,
  customers: [{ business_id: 'a', first_contact_at: '2026-10-12T06:00:00Z' }],
  orders: [{ business_id: 'a', created_at: '2026-10-11T10:00:00Z', paid_at: '2026-10-12T09:00:00Z', total: '250.50' },
           { business_id: 'a', created_at: '2026-10-12T10:00:00Z', paid_at: '2026-10-12T11:00:00Z', refunded_at: '2026-10-12T12:00:00Z', total: '99' }],
  llmCalls: [{ business_id: 'a', route: 'reply', ok: false, total_cost_usd: '0.001', created_at: '2026-10-12T06:01:00Z' },
             { business_id: 'a', route: 'raw:openai', ok: false, total_cost_usd: '0.5', created_at: '2026-10-12T06:01:00Z' }],
  aiUsage: [{ user_id: 'a', tokens_used: 1200, created_at: '2026-10-12T06:01:00Z' }],
  uxEvents: [{ business_id: 'a', surface: 'dashboard', session_id: 's1', occurred_at: '2026-10-12T05:00:00Z' },
             { business_id: 'a', surface: 'dashboard', session_id: 's1', occurred_at: '2026-10-12T05:01:00Z' },
             { business_id: 'a', surface: 'market',    session_id: 's2', occurred_at: '2026-10-12T05:01:00Z' }],
  source: 'cron', computedAt: AT, ...over,
});

test('reply latency starts at the first inbound of a turn and ignores null conversations', () => {
  const l = replyLatencies(msgs);
  const a = l.filter(x => x.business_id === 'a');
  assert.equal(a.length, 1);
  assert.equal(a[0].latency_s, 60);
});

test('reply latency ignores an outbound with no preceding inbound', () => {
  assert.deepEqual(replyLatencies([{ business_id: 'a', conversation_id: 'c', direction: 'outbound', status: 'sent', created_at: '2026-10-12T06:00:00Z' }]), []);
});

test('shop rows: counts, exclusions, and today snapshot', () => {
  const rows = buildShopDailyRows(input());
  assert.ok(rows.every(r => r.business_id === 'a'), 'internal and unknown shops excluded');
  const d12 = rows.find(r => r.day === '2026-10-12');
  assert.equal(d12.inbound_messages, 3);
  assert.equal(d12.outbound_messages, 1);
  assert.equal(d12.failed_messages, 1);
  assert.equal(d12.ai_messages, 1);
  assert.equal(d12.customers_active, 2);
  assert.equal(d12.customers_new, 1);
  assert.equal(d12.orders_created, 1);
  assert.equal(d12.orders_paid, 1, 'refunded order not counted as paid');
  assert.equal(d12.paid_order_value_etb, 250.5);
  assert.equal(d12.first_reply_p50_s, 60);
  assert.equal(d12.owner_sessions, 1, 'distinct dashboard sessions only');
  assert.equal(d12.llm_calls, 1, 'raw rows excluded');
  assert.equal(d12.llm_failed, 1);
  assert.equal(d12.llm_cost_usd, 0.001);
  assert.equal(d12.ai_tokens, 1200);
  assert.equal(d12.plan_state, 'trial');
  assert.equal(d12.payment_state, 'trial');
  const d11 = rows.find(r => r.day === '2026-10-11');
  assert.equal(d11.orders_created, 1);
  assert.equal(d11.plan_state, null, 'state snapshot only on today');
});

test('no personal data in shop rows', () => {
  const keys = Object.keys(buildShopDailyRows(input())[0]);
  for (const bad of ['name', 'phone', 'telegram_id', 'owner_telegram_id', 'content', 'customer_id']) {
    assert.ok(!keys.includes(bad), `shop_daily must not carry ${bad}`);
  }
});

test('builders are deterministic', () => {
  assert.deepEqual(buildShopDailyRows(input()), buildShopDailyRows(input()));
});

test('empty activity still snapshots every external shop today', () => {
  const rows = buildShopDailyRows(input({ messages: [], customers: [], orders: [], llmCalls: [], aiUsage: [], uxEvents: [] }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].day, TODAY);
  assert.equal(rows[0].inbound_messages, 0);
  assert.equal(rows[0].plan_state, 'trial');
});

test('platform rows: totals, funnel, and a zero row for quiet days', () => {
  const shopRows = buildShopDailyRows(input());
  const rows = buildPlatformDailyRows({
    days: DAYS, shopRows, businesses: [A, INTERNAL],
    onboardingEvents: [
      { telegram_id: 1, step: 'welcome', created_at: '2026-10-11T08:00:00Z' },
      { telegram_id: 1, step: 'welcome', created_at: '2026-10-11T08:05:00Z' },
      { telegram_id: 2, step: 'connected_shared', created_at: '2026-10-11T09:00:00Z' },
      { telegram_id: 9, step: 'welcome', created_at: '2026-10-11T08:00:00Z' },
      { telegram_id: 3, step: 'tour_started', created_at: '2026-10-11T08:00:00Z' },
    ],
    subscriptionEvents: [{ business_id: 'a', event: 'trial_converted', created_at: '2026-10-12T10:00:00Z' },
                         { business_id: 'i', event: 'subscribed', created_at: '2026-10-12T10:00:00Z' }],
    source: 'cron', computedAt: AT,
  });
  assert.deepEqual(rows.map(r => r.day), DAYS);
  const [d11, d12] = rows;
  assert.equal(d11.signups, 1, 'internal signup excluded');
  assert.equal(d11.funnel.welcome, 1, 'distinct ids, internal owner excluded');
  assert.equal(d11.funnel.connected, 1);
  assert.equal(d11.live_shops, 0);
  assert.equal(d12.live_shops, 1);
  assert.equal(d12.engaged_owners, 1);
  assert.equal(d12.inbound_messages, 3);
  assert.equal(d12.trial_converted, 1);
  assert.equal(d12.subscribed, 0, 'internal subscription excluded');
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (module not found).

- [ ] **Step 3: Implement**

```js
/**
 * Pure builders for the nightly admin rollups (spec 2026-10-13 §3.2–3.3).
 *
 * Inputs are plain rows already fetched by cron/metrics-rollup; outputs are
 * rows ready to upsert. No I/O here, so every rule is unit-tested in
 * __tests__/metricsRollup.test.mjs. Output carries ids, days, counts and
 * states only — never names, phones, telegram ids or message text.
 */
import {
  dayKeyEAT, isChainCall, isInternal, planState, paymentState, median, funnelStep, FUNNEL_STEPS,
} from './definitions.mjs';

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at);

/**
 * Time from the first inbound message of a customer turn to the next
 * successfully sent outbound in the same conversation. Messages without a
 * conversation_id cannot be paired and are skipped.
 */
export function replyLatencies(messages) {
  const byConv = new Map();
  for (const m of messages || []) {
    if (!m?.conversation_id) continue;
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }
  const out = [];
  for (const convo of byConv.values()) {
    convo.sort(byTime);
    let pending = null;
    for (const m of convo) {
      if (m.direction === 'inbound') { if (!pending) pending = m; continue; }
      if (m.direction === 'outbound' && m.status !== 'failed' && pending) {
        out.push({
          business_id: pending.business_id,
          inbound_at: pending.created_at,
          latency_s: Math.max(0, Math.round((new Date(m.created_at) - new Date(pending.created_at)) / 1000)),
        });
        pending = null;
      }
    }
  }
  return out;
}

const emptyShopRow = (business_id, day) => ({
  business_id, day,
  inbound_messages: 0, outbound_messages: 0, failed_messages: 0, ai_messages: 0,
  customers_active: 0, customers_new: 0,
  orders_created: 0, orders_paid: 0, paid_order_value_etb: 0,
  first_reply_p50_s: null, owner_sessions: 0,
  llm_calls: 0, llm_failed: 0, llm_cost_usd: 0, ai_tokens: 0,
  plan_state: null, payment_state: null,
});

export function buildShopDailyRows({
  days, todayKey, businesses = [], messages = [], customers = [], orders = [],
  llmCalls = [], aiUsage = [], uxEvents = [], source = 'cron', computedAt,
}) {
  const daySet = new Set(days);
  const external = new Map(businesses.filter(b => b && !isInternal(b)).map(b => [b.id, b]));
  const rows = new Map();
  const extra = new Map();

  const slot = (businessId, day) => {
    if (!external.has(businessId) || !daySet.has(day)) return null;
    const k = `${businessId}|${day}`;
    if (!rows.has(k)) {
      rows.set(k, emptyShopRow(businessId, day));
      extra.set(k, { customers: new Set(), sessions: new Set(), latencies: [] });
    }
    return k;
  };

  for (const m of messages) {
    const k = slot(m.business_id, dayKeyEAT(m.created_at));
    if (!k) continue;
    const r = rows.get(k);
    if (m.direction === 'inbound') {
      r.inbound_messages++;
      if (m.customer_id) extra.get(k).customers.add(m.customer_id);
    } else if (m.direction === 'outbound') {
      if (m.status === 'failed') r.failed_messages++;
      else {
        r.outbound_messages++;
        if (m.is_ai_generated) r.ai_messages++;
      }
    }
  }

  for (const l of replyLatencies(messages)) {
    const k = slot(l.business_id, dayKeyEAT(l.inbound_at));
    if (k) extra.get(k).latencies.push(l.latency_s);
  }

  for (const c of customers) {
    const k = slot(c.business_id, dayKeyEAT(c.first_contact_at || c.created_at));
    if (k) rows.get(k).customers_new++;
  }

  for (const o of orders) {
    const k1 = slot(o.business_id, dayKeyEAT(o.created_at));
    if (k1) rows.get(k1).orders_created++;
    if (o.paid_at && !o.refunded_at) {
      const k2 = slot(o.business_id, dayKeyEAT(o.paid_at));
      if (k2) {
        const r = rows.get(k2);
        r.orders_paid++;
        r.paid_order_value_etb += Number(o.total) || 0;
      }
    }
  }

  for (const l of llmCalls) {
    if (!isChainCall(l)) continue;
    const k = slot(l.business_id, dayKeyEAT(l.created_at));
    if (!k) continue;
    const r = rows.get(k);
    r.llm_calls++;
    if (l.ok === false) r.llm_failed++;
    r.llm_cost_usd += Number(l.total_cost_usd) || 0;
  }

  for (const a of aiUsage) {
    const k = slot(a.user_id, dayKeyEAT(a.created_at));
    if (k) rows.get(k).ai_tokens += Number(a.tokens_used) || 0;
  }

  for (const u of uxEvents) {
    if (u.surface !== 'dashboard' || !u.session_id) continue;
    const k = slot(u.business_id, dayKeyEAT(u.occurred_at || u.created_at));
    if (k) extra.get(k).sessions.add(u.session_id);
  }

  // State is only knowable "as of now", so it is written on today's row only.
  if (todayKey && daySet.has(todayKey)) {
    for (const b of external.values()) {
      const r = rows.get(slot(b.id, todayKey));
      r.plan_state = planState(b);
      r.payment_state = paymentState(b);
    }
  }

  return [...rows.entries()]
    .map(([k, r]) => {
      const x = extra.get(k);
      return {
        ...r,
        customers_active: x.customers.size,
        owner_sessions: x.sessions.size,
        first_reply_p50_s: median(x.latencies),
        paid_order_value_etb: round(r.paid_order_value_etb, 2),
        llm_cost_usd: round(r.llm_cost_usd, 6),
        source,
        computed_at: computedAt,
      };
    })
    .sort((a, b) => (a.business_id < b.business_id ? -1 : a.business_id > b.business_id ? 1 : a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

const SUM_FIELDS = ['inbound_messages', 'outbound_messages', 'failed_messages', 'orders_created', 'orders_paid', 'llm_calls', 'llm_failed', 'llm_cost_usd'];
const SUB_EVENTS = ['trial_converted', 'subscribed', 'expired'];

export function buildPlatformDailyRows({
  days, shopRows = [], businesses = [], onboardingEvents = [], subscriptionEvents = [], source = 'cron', computedAt,
}) {
  const internal = businesses.filter(isInternal);
  const internalIds = new Set(internal.map(b => b.id));
  const internalTg = new Set(internal.map(b => b.owner_telegram_id).filter(v => v != null).map(String));

  const out = new Map(days.map(day => [day, {
    day, signups: 0, live_shops: 0, engaged_owners: 0,
    ...Object.fromEntries(SUM_FIELDS.map(f => [f, 0])),
    ...Object.fromEntries(SUB_EVENTS.map(e => [e, 0])),
    funnel: Object.fromEntries(FUNNEL_STEPS.map(s => [s, 0])),
    source, computed_at: computedAt,
  }]));

  for (const b of businesses) {
    if (isInternal(b)) continue;
    const r = out.get(dayKeyEAT(b.created_at));
    if (r) r.signups++;
  }

  for (const s of shopRows) {
    const r = out.get(s.day);
    if (!r) continue;
    if (s.inbound_messages > 0) r.live_shops++;
    if (s.owner_sessions > 0) r.engaged_owners++;
    for (const f of SUM_FIELDS) r[f] += Number(s[f]) || 0;
  }

  const seen = new Map();
  for (const e of onboardingEvents) {
    const step = funnelStep(e.step);
    const day = dayKeyEAT(e.created_at);
    if (!step || !out.has(day) || e.telegram_id == null || internalTg.has(String(e.telegram_id))) continue;
    const k = `${day}|${step}`;
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(String(e.telegram_id));
  }
  for (const [k, ids] of seen) {
    const [day, step] = k.split('|');
    out.get(day).funnel[step] = ids.size;
  }

  for (const e of subscriptionEvents) {
    if (internalIds.has(e.business_id) || !SUB_EVENTS.includes(e.event)) continue;
    const r = out.get(dayKeyEAT(e.created_at));
    if (r) r[e.event]++;
  }

  return [...out.values()]
    .map(r => ({ ...r, llm_cost_usd: round(r.llm_cost_usd, 6) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
```

- [ ] **Step 4: Run to verify pass** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/metrics/rollup.mjs apps/web/src/lib/server/__tests__/metricsRollup.test.mjs
git commit -m "feat(metrics): pure shop/platform daily rollup builders"
```

---

### Task 5: Nightly rollup cron

**Files:**
- Create: `apps/web/src/app/api/cron/metrics-rollup/route.js`
- Modify: `apps/web/vercel.json` (crons array)
- Test: `apps/web/src/lib/server/__tests__/metricTruthGuards.test.mjs` (append)

**Interfaces:**
- Consumes: Task 3 `RECOMPUTE_DAYS`, `MAX_BACKFILL_DAYS`, `eatMidnightIso`; Task 4 builders; `fetchAllRows`, `lastNDaysEAT`, `dayKeyEAT`; `sendTelegramMessage(token, payload)`; `getAdminIds()`.
- Produces: `GET /api/cron/metrics-rollup[?days=N][&dry_run=1]` → `{ ok, days_from, days_to, shop_rows, platform_rows, source }`.

- [ ] **Step 1: Append failing test**

```js
test('metrics-rollup cron is authorized, idempotent, and scheduled', () => {
  const src = stripComments(read('app/api/cron/metrics-rollup/route.js'));
  assert.match(src, /isCronAuthorized\(request\)/);
  assert.match(src, /onConflict:\s*'business_id,day'/);
  assert.match(src, /onConflict:\s*'day'/);
  assert.match(src, /metrics_rollup_runs/);
  const vercel = JSON.parse(readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8'));
  assert.ok(vercel.crons.some(c => c.path === '/api/cron/metrics-rollup' && c.schedule === '0 23 * * *'));
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (file missing).

- [ ] **Step 3: Implement route**

```js
/**
 * GET /api/cron/metrics-rollup — nightly admin rollups (spec 2026-10-13 §3.3).
 *
 * Recomputes the last RECOMPUTE_DAYS EAT days into shop_daily / platform_daily
 * (upserts, so re-runs are idempotent and late events land on the right day).
 * When platform_daily is empty it backfills MAX_BACKFILL_DAYS instead, marked
 * source='backfill'. ?days=N overrides the window (1..MAX_BACKFILL_DAYS).
 *
 * Must run nightly: ux_events are purged at 90 days by data-retention, so
 * owner-session counts have to be captured before that.
 *
 * Scheduled 23:00 UTC = 02:00 EAT. Every run is logged to metrics_rollup_runs;
 * a failure DMs the platform admins.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { getAdminIds } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, lastNDaysEAT, dayKeyEAT } from '../../../../lib/server/fetch-all.mjs';
import { sendTelegramMessage } from '../../../../lib/server/telegram-send.mjs';
import { RECOMPUTE_DAYS, MAX_BACKFILL_DAYS, eatMidnightIso } from '../../../../lib/server/metrics/definitions.mjs';
import { buildShopDailyRows, buildPlatformDailyRows } from '../../../../lib/server/metrics/rollup.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UPSERT_CHUNK = 500;
const BUSINESS_COLS = 'id, created_at, is_internal, owner_telegram_id, plan_tier, subscription_plan, subscription_status, trial_ends_at, subscription_expires_at, payment_verified, payment_proof_url, payment_ref';

async function upsertChunked(sb, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

async function alertAdmins(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return;
  for (const id of getAdminIds()) {
    await sendTelegramMessage(token, { chat_id: id, text }).catch(() => {});
  }
}

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const sb = supabase();

  let nDays = Number(url.searchParams.get('days'));
  if (!Number.isInteger(nDays) || nDays < 1) {
    const { count } = await sb.from('platform_daily').select('day', { count: 'exact', head: true });
    nDays = count ? RECOMPUTE_DAYS : MAX_BACKFILL_DAYS;
  }
  nDays = Math.min(nDays, MAX_BACKFILL_DAYS);
  const source = nDays > RECOMPUTE_DAYS ? 'backfill' : 'cron';

  const now = Date.now();
  const days = lastNDaysEAT(nDays, now);
  const todayKey = dayKeyEAT(now);
  const since = eatMidnightIso(days[0]);
  const computedAt = new Date(now).toISOString();

  let runId = null;
  if (!dryRun) {
    const { data } = await sb.from('metrics_rollup_runs')
      .insert({ days_from: days[0], days_to: days[days.length - 1] }).select('id').single();
    runId = data?.id ?? null;
  }

  try {
    const [businesses, messages, customers, orders, llmCalls, aiUsage, uxEvents, onboardingEvents, subscriptionEvents] = await Promise.all([
      must('businesses', fetchAllRows(() => sb.from('businesses').select(BUSINESS_COLS).order('id'))),
      must('messages', fetchAllRows(() => sb.from('messages')
        .select('business_id, conversation_id, customer_id, direction, status, is_ai_generated, created_at')
        .gte('created_at', since).order('created_at').order('id'))),
      must('customers', fetchAllRows(() => sb.from('customers')
        .select('business_id, first_contact_at, created_at').gte('created_at', since).order('created_at').order('id'))),
      must('orders', fetchAllRows(() => sb.from('orders')
        .select('business_id, created_at, paid_at, refunded_at, total')
        .or(`created_at.gte.${since},paid_at.gte.${since}`).order('created_at').order('id'))),
      must('llm_call_log', fetchAllRows(() => sb.from('llm_call_log')
        .select('business_id, route, ok, total_cost_usd, created_at').gte('created_at', since).order('id'))),
      must('ai_usage', fetchAllRows(() => sb.from('ai_usage')
        .select('user_id, tokens_used, created_at').gte('created_at', since).order('created_at').order('id'))),
      must('ux_events', fetchAllRows(() => sb.from('ux_events')
        .select('business_id, surface, session_id, occurred_at, created_at')
        .eq('surface', 'dashboard').gte('created_at', since).order('id'))),
      must('onboarding_events', fetchAllRows(() => sb.from('onboarding_events')
        .select('telegram_id, step, created_at').gte('created_at', since).order('id'))),
      must('subscription_events', fetchAllRows(() => sb.from('subscription_events')
        .select('business_id, event, created_at').gte('created_at', since).order('created_at').order('id'))),
    ]);

    const shopRows = buildShopDailyRows({ days, todayKey, businesses, messages, customers, orders, llmCalls, aiUsage, uxEvents, source, computedAt });
    const platformRows = buildPlatformDailyRows({ days, shopRows, businesses, onboardingEvents, subscriptionEvents, source, computedAt });

    if (!dryRun) {
      await upsertChunked(sb, 'shop_daily', shopRows, 'business_id,day');
      await upsertChunked(sb, 'platform_daily', platformRows, 'day');
      if (runId) await sb.from('metrics_rollup_runs').update({
        finished_at: new Date().toISOString(), shop_rows: shopRows.length, platform_rows: platformRows.length, ok: true,
      }).eq('id', runId);
    }

    return NextResponse.json({
      ok: true, dry_run: dryRun, source, days_from: days[0], days_to: days[days.length - 1],
      shop_rows: shopRows.length, platform_rows: platformRows.length,
    });
  } catch (e) {
    console.error('[cron/metrics-rollup] failed:', e.message);
    if (runId) await sb.from('metrics_rollup_runs').update({
      finished_at: new Date().toISOString(), ok: false, error: String(e.message).slice(0, 1000),
    }).eq('id', runId);
    if (!dryRun) await alertAdmins(`⚠️ Admin metrics rollup failed: ${String(e.message).slice(0, 300)}\nDashboard numbers are stale until it succeeds.`);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
```

In `apps/web/vercel.json` crons array, after the `activity-rollup` entry add:

```json
    { "path": "/api/cron/metrics-rollup",   "schedule": "0 23 * * *" },
```

- [ ] **Step 4: Run full suite** — `cd apps/web && node --test src/lib/server/__tests__/*.test.mjs` → PASS.

- [ ] **Step 5: Local dry run against production data** (read-only):

```bash
cd apps/web && npx next dev -p 3005   # background
curl -s -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3005/api/cron/metrics-rollup?days=30&dry_run=1"
```
Expected: `{"ok":true,"dry_run":true,...,"platform_rows":30,"shop_rows":>0}`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/cron/metrics-rollup/route.js apps/web/vercel.json apps/web/src/lib/server/__tests__/metricTruthGuards.test.mjs
git commit -m "feat(metrics): nightly admin rollup cron with self-backfill"
```

---

### Task 6: Deploy and verify on Vercel

- [ ] **Step 1:** Confirm which branch production builds from (Vercel MCP `list_deployments`, latest production target, `meta.githubCommitRef`). Per memory, it may be `feat/swap-barter`; diff it against `main` before pushing.
- [ ] **Step 2:** `git push origin feat/swap-barter` (or the confirmed production branch).
- [ ] **Step 3:** Watch the deployment to `READY` (`get_deployment`); on `ERROR`, read build logs and fix.
- [ ] **Step 4:** Trigger the first run on production:
  `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<prod-domain>/api/cron/metrics-rollup`
  Expected: `{"ok":true,"source":"backfill","platform_rows":400,...}`.
- [ ] **Step 5:** Verify in SQL: `select count(*), min(day), max(day) from platform_daily;` (400 rows), `select ok, shop_rows from metrics_rollup_runs order by id desc limit 1;` (`ok=true`), and spot-check one day's `inbound_messages` against `select count(*) from messages where direction='inbound' and (created_at at time zone 'Africa/Addis_Ababa')::date = '<day>'`.
- [ ] **Step 6:** Re-run with `?days=3` and confirm row values are unchanged for those days (idempotency on prod).

---

### Task 7: Repair the stripped trials (after Task 6 is live)

Must run **after** the billing fix is deployed, or the next AI reply re-breaks each shop.

**Files:**
- Create: `packages/db/migrations/061_repair_trial_status_sync.sql`

- [ ] **Step 1: Preview** (expect 15 rows: 13 → trial, 2 → expired as of 2026-10-12):

```sql
select b.id, b.name, b.trial_ends_at,
       case when b.trial_ends_at > now() then 'trial' else 'expired' end as new_status
from businesses b join subscriptions s on s.user_id = b.id
where coalesce(b.plan_tier,'free') <> 'pro' and b.subscription_status = 'active'
  and b.subscription_expires_at is null and s.plan_name = 'free'
  and coalesce(b.payment_verified,false) = false and b.payment_proof_url is null;
```

- [ ] **Step 2: Write migration**

```sql
-- 061_repair_trial_status_sync.sql
-- billing.deductCreditAndLogUsage copied subscriptions.status ('active' by
-- default) onto businesses.subscription_status on every AI reply. planStatus()
-- reads active-with-no-expiry as not Pro, so these shops lost their trial on
-- their first customer reply. Fixed in code (fix(billing) commit); this puts
-- each affected shop back where it should be: trial if its trial window is
-- still open, expired otherwise. Every change is written to audit_logs.
with affected as (
  select b.id, b.subscription_status as before_status,
         case when b.trial_ends_at > now() then 'trial' else 'expired' end as after_status
  from public.businesses b
  join public.subscriptions s on s.user_id = b.id
  where coalesce(b.plan_tier, 'free') <> 'pro'
    and b.subscription_status = 'active'
    and b.subscription_expires_at is null
    and s.plan_name = 'free'
    and coalesce(b.payment_verified, false) = false
    and b.payment_proof_url is null
), updated as (
  update public.businesses b
     set subscription_status = a.after_status
    from affected a
   where b.id = a.id
  returning b.id, a.before_status, a.after_status
)
insert into public.audit_logs (business_id, actor_type, actor_id, action, resource_type, resource_id, metadata)
select id, 'system', 'migration_061', 'billing.trial_status_repair', 'business', id::text,
       jsonb_build_object('before', before_status, 'after', after_status)
from updated;
```

- [ ] **Step 3: Get the owner's go-ahead on the preview, then apply** via `apply_migration` name `061_repair_trial_status_sync`.
- [ ] **Step 4: Verify** the preview query now returns 0 rows and `select count(*) from audit_logs where action='billing.trial_status_repair'` = 15.
- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/061_repair_trial_status_sync.sql
git commit -m "fix(billing): restore trials stripped by the status sync"
```

---

## Follow-on plans (written after this ships, each its own plan)

- **Sub-project 2 — Dashboard shell + six sections** (`/admin` → sections reading `shop_daily`/`platform_daily`; legacy at `/admin/legacy`). Includes the "data as of" banner and a Pulse alert when the newest `metrics_rollup_runs` success is older than `STALE_AFTER_HOURS` — this plan only alerts on a *failed* run, not a missing one.
- **Sub-project 3 — Privacy layer** (roles via `ADMIN_OWNER_IDS`, masking, reveal, exports, retention panel, DSAR queue, owner erasure re-keying of `shop_daily`).
- **Sub-project 4 — Messaging rules** (`canMessage()` across broadcast/outreach/nudges/re-engagement, campaign opt-out reporting).
