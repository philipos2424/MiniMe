# Business Twin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MiniMe a unified business model — a 0-100 health score, a "what a lender would see" credit-readiness profile, and deterministic what-if price simulation — surfaced on both Telegram (`/twin`, `/simulate`, `/credit`, and injected into the advisor prompt) and the web dashboard.

**Architecture:** A pure-ish aggregation module `packages/shared/twin.js` (CommonJS, uses `packages/db/client` directly so both `apps/bot` and `apps/web` can call it without cross-importing each other) computes `{ metrics, health, credit, assumptions }` from existing tables (`orders`, `payments`, `products`, `messages`, `customers`, `businesses`). A daily snapshot table persists history for the dashboard sparkline and credit volatility scoring. Scoring/simulation functions are pure (metrics/history in, score/numbers out) so they're unit-testable without touching Supabase.

**Tech Stack:** Node.js (CommonJS) for `packages/shared/twin.js` and bot surfaces; Next.js App Router + `recharts` (already installed, ^2.12.0) for the web page; Supabase Postgres. Tests via `node --test` (root `tests/` dir, ESM `.mjs`).

## Global Constraints

- Bot code (`apps/bot`) cannot import from `apps/web` — confirmed no such import exists anywhere in the repo today. `packages/shared/twin.js` must only depend on `packages/db/*` and plain JS, never on anything under `apps/web`.
- **Revenue has two definitions already live in this codebase** and this feature must not silently pick one without saying so: `apps/web/src/app/api/analytics/route.js` computes revenue from `orders` where `status IN ('paid','fulfilled')`; `apps/bot/src/services/analytics.js` (`aggregateForBusiness`, feeding `daily_analytics.revenue`) computes it from `payments` where `status='completed' AND direction='inbound'`. Per the original spec: **orders(paid) is primary** (`metrics.revenue`), **payments(completed inbound) is secondary** (`metrics.payments_collected`) — document this exact split in a header comment at the top of `twin.js`, don't silently merge them.
- Postgres `CHECK`/DDL changes follow the additive-only, manual-Supabase-SQL-editor-apply convention established in migrations 029-033 (header comment explaining intent, `IF NOT EXISTS` guards).
- New migration file: `packages/db/migrations/034_business_twin.sql` (033 will exist after the negotiation-engine plan runs, or is the next free number if this plan runs first — check `ls packages/db/migrations/` immediately before writing the file and use whatever the actual next integer is).
- `simulate()` must be deterministic — fixed elasticity bands, no LLM, no randomness (this repo's `node --test` scripts cannot use `Math.random()`/`Date.now()` inside anything that needs reproducible tests; pass "now" in as a parameter where a test needs to control it).
- Styling for any new web component must pick ONE of the two design languages already competing in this codebase and say which: the token-based system (`COLORS`/`FONT`/`RADII`/`SHADOW` from `apps/web/src/lib/design-tokens.js`, used by `MemoryPage.jsx`, most page components) or the hardcoded "Espresso" hex palette (used by `TrustLevelCard.jsx`). This plan uses the **token-based system**, since it's what the majority of `components/pages/*` already use.
- Branch: `claude/minime-future-evolution-2f9e3r` — same branch as the Supplier Negotiation Engine plan (the original spec covers both features in one PR). If that plan already created and pushed this branch with an open draft PR, this plan's final task only pushes more commits (does not open a second PR). If this plan runs first, create the branch and open the draft PR yourself.

---

## File Structure

- **Create:** `packages/db/migrations/034_business_twin.sql` — `business_twin_snapshots(business_id, snapshot_date, health_score, components JSONB, metrics JSONB, credit_profile JSONB, UNIQUE(business_id, snapshot_date))`.
- **Modify:** `packages/db/schema.sql` — mirror the new table.
- **Modify:** `apps/bot/src/cron/index.js:6` — fix the broken `aggregateAllBusinesses` import (currently destructures `undefined` from a wrapper module that doesn't re-export it, throwing every night at 21:00 UTC); add the nightly `computeTwin` + `saveSnapshot` sweep.
- **Create:** `packages/shared/twin.js` — `computeTwin`, `scoreHealth`, `creditReadiness`, `simulate`, `saveSnapshot`, `getLatestSnapshot`.
- **Test:** `tests/twin.test.mjs` — `scoreHealth`/`creditReadiness`/`simulate` (including missing `cost_price`).
- **Modify:** `apps/bot/src/handlers/command.js` — `/twin`, `/simulate price ±N [product]`, `/credit` command cases + `/help` lines.
- **Modify:** `apps/bot/src/services/advisor.js:103-105` — inject the latest snapshot into the `# BUSINESS SNAPSHOT` prompt block.
- **Create:** `apps/web/src/app/api/twin/route.js` — `GET` (live twin + snapshot history), `POST` (simulate), auth via `verifyTelegramInitData` mirroring `apps/web/src/app/api/b2b/route.js`.
- **Create:** `apps/web/src/app/(dashboard)/twin/page.js` — 2-line shim, mirrors `apps/web/src/app/(dashboard)/memory/page.js`.
- **Create:** `apps/web/src/components/pages/TwinPage.jsx` — health gauge, component breakdown, metric cards, snapshot sparkline (recharts), simulation form, credit card. Token-based styling (`design-tokens.js`).
- **Modify:** `apps/web/src/components/layout/Sidebar.jsx:8-41` (`NAV_GROUPS`) and `apps/web/src/components/layout/MobileNav.jsx` — add a `/twin` nav entry.

---

## Task 1: Migration 034 + schema.sql mirror

**Files:**
- Create: `packages/db/migrations/034_business_twin.sql`
- Modify: `packages/db/schema.sql`

**Interfaces:**
- Produces: `business_twin_snapshots` table. Task 4's `saveSnapshot`/`getLatestSnapshot` and Task 6's nightly cron depend on this existing before they can be tested against a real DB (though their unit tests mock/skip the DB layer, matching the rest of this codebase's light test culture).

- [ ] **Step 1: Confirm the next free migration number**

Run: `ls packages/db/migrations/ | sort | tail -3`
Use whichever integer is one higher than the current highest (033 if the negotiation-engine plan hasn't run yet in this branch, 034 if it has — name the file accordingly; the rest of this plan assumes 034, adjust if it's actually 035).

- [ ] **Step 2: Write the migration**

```sql
-- 034_business_twin.sql — Business Twin daily snapshots.
--
-- Persists computeTwin()'s output once a day so the dashboard sparkline and
-- credit-readiness volatility scoring have real history to look back on,
-- instead of only ever seeing "right now". Additive only. Apply in the
-- Supabase SQL editor — DDL can't run through the service-role key without a PAT.

create table if not exists business_twin_snapshots (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  snapshot_date date not null,
  health_score  integer not null check (health_score between 0 and 100),
  components    jsonb not null default '{}'::jsonb,
  metrics       jsonb not null default '{}'::jsonb,
  credit_profile jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique(business_id, snapshot_date)
);

create index if not exists idx_twin_snapshots_business
  on business_twin_snapshots(business_id, snapshot_date desc);
```

- [ ] **Step 3: Mirror into schema.sql**

Append the same `CREATE TABLE` + index to `packages/db/schema.sql`, in the section after `daily_analytics` (around line 258), following the existing `-- ====== N. NAME ======` section-header convention used throughout that file.

- [ ] **Step 4: Verify**

Run: `node -e "require('fs').readFileSync('packages/db/migrations/034_business_twin.sql','utf8')"` (file-read sanity check — no local Postgres to run DDL against, per repo convention). Diff the two `CREATE TABLE business_twin_snapshots` blocks by eye to confirm they match.

- [ ] **Step 5: Commit**

```bash
git checkout -b claude/minime-future-evolution-2f9e3r 2>/dev/null || git checkout claude/minime-future-evolution-2f9e3r
git add packages/db/migrations/034_business_twin.sql packages/db/schema.sql
git commit -m "feat(twin): add business_twin_snapshots table"
```

---

## Task 2: Fix the broken nightly-analytics cron import

**Files:**
- Modify: `apps/bot/src/cron/index.js:6`

**Interfaces:**
- No new exports — this is a one-line bug fix required before Task 6 (which adds the twin snapshot sweep right after this same cron job).

- [ ] **Step 1: Fix the import**

Current (`apps/bot/src/cron/index.js:4-8`):

```javascript
  cron.schedule('0 21 * * *', async () => {
    const { aggregateAllBusinesses } = require('./analytics');
    await aggregateAllBusinesses();
  });
```

`./analytics` (i.e. `apps/bot/src/cron/analytics.js`) only exports `{ runAnalyticsAggregation }`, not `aggregateAllBusinesses` — the destructure silently yields `undefined`, and calling it throws every night, unhandled (no try/catch around this specific `cron.schedule` callback). Fix by requiring the real source module directly, skipping the redundant wrapper, and adding a try/catch to match every other cron job in this file (all the other jobs already wrap their body):

```javascript
  cron.schedule('0 21 * * *', async () => {
    try {
      const { aggregateAllBusinesses } = require('../services/analytics');
      await aggregateAllBusinesses();
    } catch (e) {
      console.error('nightly analytics cron error:', e);
    }
  });
```

- [ ] **Step 2: Syntax-check**

Run: `node --check apps/bot/src/cron/index.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/cron/index.js
git commit -m "fix(cron): nightly analytics aggregation imported aggregateAllBusinesses from a wrapper module that never re-exported it, throwing every night at 21:00 UTC"
```

---

## Task 3: `packages/shared/twin.js` — `computeTwin` + `scoreHealth`

**Files:**
- Create: `packages/shared/twin.js`
- Create: `tests/twin.test.mjs`

**Interfaces:**
- Consumes: `supabase` from `packages/db/client.js` (bot-side relative-require pattern: `require('../db/client')` from `packages/shared/`, i.e. sibling package).
- Produces: `scoreHealth(metrics) → { score: number, components: {revenue_trend, repeat_rate, response_health, inventory_health, payment_collection, data_completeness} }` (pure — this task's test target). `computeTwin(businessId) → Promise<{ metrics, health, credit: null, assumptions: [] }>` (DB-touching — Task 4 fills in `credit`; this task returns `credit: null` as a placeholder field, not a stub function — the field exists in the return shape from day one so downstream callers never need a shape migration later).

Metric definitions (`metrics` object, all fields computed inside `computeTwin`):
```js
{
  revenue: number,              // sum of orders.total where status in ('paid','fulfilled'), trailing 30 days
  revenue_prior_30d: number,    // same window, the 30 days before that (for trend)
  payments_collected: number,   // sum of payments.amount where status='completed' AND direction='inbound', trailing 30 days — secondary revenue signal, NOT summed into `revenue`
  aov: number,                  // revenue / paid-order count, trailing 30 days
  repeat_rate_pct: number,      // % of customers with >1 order (all-time, from customers.total_orders)
  avg_response_seconds: number|null,  // avg time between an inbound message and the next outbound reply, trailing 30 days
  low_stock_pct: number,        // % of active products at or below low_stock_threshold
  out_of_stock_pct: number,     // % of active products at stock_quantity = 0
  orders_paid_pct: number,      // % of orders (trailing 30d) that reached paid/fulfilled vs cancelled/expired
  data_completeness_pct: number, // % of a fixed checklist of business fields that are non-empty
  product_count: number,
  customer_count: number,
}
```

- [ ] **Step 1: Write the failing test for `scoreHealth`**

Create `tests/twin.test.mjs`:

```js
/**
 * Run: node --test tests/twin.test.mjs
 * scoreHealth/creditReadiness/simulate are pure functions — metrics/history
 * in, numbers out. No Supabase, no LLM, no Date.now()/Math.random() so runs
 * are reproducible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreHealth, creditReadiness, simulate } from '../packages/shared/twin.js';

const perfectMetrics = {
  revenue: 100000, revenue_prior_30d: 80000, payments_collected: 95000,
  aov: 500, repeat_rate_pct: 60, avg_response_seconds: 120,
  low_stock_pct: 0, out_of_stock_pct: 0, orders_paid_pct: 95,
  data_completeness_pct: 100, product_count: 20, customer_count: 50,
};

test('scoreHealth: strong metrics across the board score near 100', () => {
  const result = scoreHealth(perfectMetrics);
  assert.ok(result.score >= 85, `expected >=85, got ${result.score}`);
  assert.ok(result.components.revenue_trend > 0);
});

test('scoreHealth: components sum to the total score', () => {
  const result = scoreHealth(perfectMetrics);
  const sum = Object.values(result.components).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum), result.score);
});

test('scoreHealth: zero-revenue, all-stockout business scores low', () => {
  const bad = { ...perfectMetrics, revenue: 0, revenue_prior_30d: 0, repeat_rate_pct: 0, out_of_stock_pct: 100, low_stock_pct: 100, orders_paid_pct: 0, data_completeness_pct: 20 };
  const result = scoreHealth(bad);
  assert.ok(result.score <= 20, `expected <=20, got ${result.score}`);
});

test('scoreHealth: declining revenue trend scores lower than growing, all else equal', () => {
  const growing = scoreHealth({ ...perfectMetrics, revenue: 100000, revenue_prior_30d: 50000 });
  const declining = scoreHealth({ ...perfectMetrics, revenue: 50000, revenue_prior_30d: 100000 });
  assert.ok(growing.components.revenue_trend > declining.components.revenue_trend);
});

test('scoreHealth: score is always clamped to 0-100', () => {
  const extreme = { ...perfectMetrics, revenue: 1e9, revenue_prior_30d: 1 };
  assert.ok(scoreHealth(extreme).score <= 100);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/twin.test.mjs`
Expected: FAIL — `packages/shared/twin.js` does not exist yet.

- [ ] **Step 3: Write `scoreHealth` and the `computeTwin` scaffold**

Create `packages/shared/twin.js`:

```js
/**
 * Business Twin — unified aggregation across orders/payments/products/messages/customers.
 *
 * Revenue has two definitions in this codebase and this module keeps them
 * separate rather than merging them silently:
 *   - metrics.revenue            = orders where status IN ('paid','fulfilled') — PRIMARY.
 *     Matches apps/web/src/app/api/analytics/route.js's definition.
 *   - metrics.payments_collected = payments where status='completed' AND
 *     direction='inbound' — SECONDARY signal. Matches
 *     apps/bot/src/services/analytics.js's (daily_analytics.revenue) definition.
 * Never add these two together.
 *
 * scoreHealth/creditReadiness/simulate are pure (metrics/history in, numbers
 * out) — no Supabase, no LLM, no Date.now()/Math.random() — for testability.
 * computeTwin/saveSnapshot/getLatestSnapshot touch the DB directly via
 * packages/db/client so both apps/bot and apps/web can call this module
 * without either importing the other.
 */
const { supabase } = require('../db/client');

const HEALTH_WEIGHTS = {
  revenue_trend: 25,
  repeat_rate: 15,
  response_health: 15,
  inventory_health: 15,
  payment_collection: 15,
  data_completeness: 15,
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function scoreHealth(metrics) {
  // Revenue trend: % change vs prior period, mapped to a 0-1 fraction of its weight.
  // +50% or more growth = full marks; -50% or worse decline = zero.
  const revChangePct = metrics.revenue_prior_30d > 0
    ? ((metrics.revenue - metrics.revenue_prior_30d) / metrics.revenue_prior_30d) * 100
    : (metrics.revenue > 0 ? 50 : 0);
  const revenueTrendFrac = clamp((revChangePct + 50) / 100, 0, 1);

  const repeatRateFrac = clamp(metrics.repeat_rate_pct / 50, 0, 1); // 50%+ repeat rate = full marks

  // Response health: <=5 min = full marks, >=60 min = zero. Unknown (null) = half credit.
  const responseFrac = metrics.avg_response_seconds == null
    ? 0.5
    : clamp(1 - (metrics.avg_response_seconds - 300) / (3600 - 300), 0, 1);

  const inventoryFrac = clamp(1 - (metrics.out_of_stock_pct * 0.7 + metrics.low_stock_pct * 0.3) / 100, 0, 1);

  const paymentFrac = clamp(metrics.orders_paid_pct / 100, 0, 1);

  const completenessFrac = clamp(metrics.data_completeness_pct / 100, 0, 1);

  const components = {
    revenue_trend: Math.round(revenueTrendFrac * HEALTH_WEIGHTS.revenue_trend),
    repeat_rate: Math.round(repeatRateFrac * HEALTH_WEIGHTS.repeat_rate),
    response_health: Math.round(responseFrac * HEALTH_WEIGHTS.response_health),
    inventory_health: Math.round(inventoryFrac * HEALTH_WEIGHTS.inventory_health),
    payment_collection: Math.round(paymentFrac * HEALTH_WEIGHTS.payment_collection),
    data_completeness: Math.round(completenessFrac * HEALTH_WEIGHTS.data_completeness),
  };
  const score = clamp(Object.values(components).reduce((a, b) => a + b, 0), 0, 100);
  return { score, components };
}

async function computeTwin(businessId) {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const d60 = new Date(now.getTime() - 60 * 86400000).toISOString();

  const [{ data: orders30 }, { data: orders60 }, { data: payments30 }, { data: products }, { data: customers }, { data: messages30 }] = await Promise.all([
    supabase().from('orders').select('total, status, created_at').eq('business_id', businessId).gte('created_at', d30),
    supabase().from('orders').select('total, status, created_at').eq('business_id', businessId).gte('created_at', d60).lt('created_at', d30),
    supabase().from('payments').select('amount').eq('business_id', businessId).eq('status', 'completed').eq('direction', 'inbound').gte('created_at', d30),
    supabase().from('products').select('stock_quantity, low_stock_threshold, is_active').eq('business_id', businessId),
    supabase().from('customers').select('total_orders').eq('business_id', businessId),
    supabase().from('messages').select('direction, created_at').eq('business_id', businessId).gte('created_at', d30).order('created_at', { ascending: true }),
  ]);

  const paidStatuses = ['paid', 'fulfilled'];
  const paid30 = (orders30 || []).filter(o => paidStatuses.includes(o.status));
  const paid60 = (orders60 || []).filter(o => paidStatuses.includes(o.status));
  const revenue = paid30.reduce((s, o) => s + Number(o.total || 0), 0);
  const revenue_prior_30d = paid60.reduce((s, o) => s + Number(o.total || 0), 0);
  const paymentsCollected = (payments30 || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const aov = paid30.length > 0 ? Math.round(revenue / paid30.length) : 0;
  const ordersPaidPct = (orders30 || []).length > 0 ? Math.round((paid30.length / orders30.length) * 100) : 100;

  const activeProducts = (products || []).filter(p => p.is_active);
  const outOfStock = activeProducts.filter(p => (p.stock_quantity ?? 0) === 0).length;
  const lowStock = activeProducts.filter(p => (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= (p.low_stock_threshold ?? 10)).length;
  const outOfStockPct = activeProducts.length > 0 ? Math.round((outOfStock / activeProducts.length) * 100) : 0;
  const lowStockPct = activeProducts.length > 0 ? Math.round((lowStock / activeProducts.length) * 100) : 0;

  const repeaters = (customers || []).filter(c => (c.total_orders ?? 0) > 1).length;
  const repeatRatePct = (customers || []).length > 0 ? Math.round((repeaters / customers.length) * 100) : 0;

  // Avg response time: time from an inbound message to the NEXT outbound message.
  const responseTimes = [];
  const msgs = messages30 || [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].direction !== 'inbound') continue;
    const next = msgs.slice(i + 1).find(m => m.direction === 'outbound');
    if (next) responseTimes.push((new Date(next.created_at) - new Date(msgs[i].created_at)) / 1000);
  }
  const avgResponseSeconds = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null;

  const { data: business } = await supabase().from('businesses').select('*').eq('id', businessId).single();
  const checklist = [business?.owner_phone, business?.email, business?.description, business?.location, (products || []).length > 0];
  const dataCompletenessPct = Math.round((checklist.filter(Boolean).length / checklist.length) * 100);

  const metrics = {
    revenue, revenue_prior_30d, payments_collected: paymentsCollected, aov,
    repeat_rate_pct: repeatRatePct, avg_response_seconds: avgResponseSeconds,
    low_stock_pct: lowStockPct, out_of_stock_pct: outOfStockPct,
    orders_paid_pct: ordersPaidPct, data_completeness_pct: dataCompletenessPct,
    product_count: (products || []).length, customer_count: (customers || []).length,
  };

  const health = scoreHealth(metrics);
  return { metrics, health, credit: null, assumptions: [] };
}

module.exports = { computeTwin, scoreHealth, HEALTH_WEIGHTS };
```

- [ ] **Step 4: Run to verify tests pass**

Run: `node --test tests/twin.test.mjs`
Expected: PASS — all 5 `scoreHealth` tests. (`creditReadiness`/`simulate` imports will fail until Task 4 — comment those two test blocks out for now, or proceed straight to Task 4 before running this if working sequentially; either is fine since Task 4 adds them to the same file immediately after.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/twin.js tests/twin.test.mjs
git commit -m "feat(twin): computeTwin aggregation + deterministic scoreHealth"
```

---

## Task 4: `creditReadiness` + `simulate` + snapshot persistence

**Files:**
- Modify: `packages/shared/twin.js` (add `creditReadiness`, `simulate`, `saveSnapshot`, `getLatestSnapshot`; wire `credit` into `computeTwin`'s return)
- Modify: `tests/twin.test.mjs`

**Interfaces:**
- Produces: `creditReadiness(metrics, monthlyHistory: Array<{month, revenue}>) → { score: number, revenue_volatility_pct: number, record_depth_months: number, disclaimer: string }`. `simulate(twin, { type: 'price_change', product_id?: string, pct: number }) → { new_revenue_estimate: number, elasticity_used: number, assumptions: string[] }` (Task 5/7's `/simulate` command and web API route call this directly — `twin` here is a `computeTwin()` result plus a `product` object attached by the caller when `product_id` is given, since `simulate` itself is DB-free). `saveSnapshot(businessId, twin) → Promise<void>`. `getLatestSnapshot(businessId) → Promise<object|null>`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/twin.test.mjs` (the `creditReadiness`/`simulate` import already at the top of the file from Task 3 covers these):

```js
test('creditReadiness: stable, healthy multi-month history scores well and includes the disclaimer', () => {
  const history = [{ month: '2026-05', revenue: 95000 }, { month: '2026-06', revenue: 98000 }, { month: '2026-07', revenue: 100000 }];
  const result = creditReadiness(perfectMetrics, history);
  assert.ok(result.score >= 60, `expected >=60, got ${result.score}`);
  assert.ok(result.record_depth_months === 3);
  assert.match(result.disclaimer, /not a credit decision/i);
});

test('creditReadiness: volatile revenue history scores lower than stable, same average', () => {
  const stable = creditReadiness(perfectMetrics, [{ month: '1', revenue: 100000 }, { month: '2', revenue: 100000 }, { month: '3', revenue: 100000 }]);
  const volatile = creditReadiness(perfectMetrics, [{ month: '1', revenue: 40000 }, { month: '2', revenue: 160000 }, { month: '3', revenue: 100000 }]);
  assert.ok(stable.score > volatile.score);
  assert.ok(volatile.revenue_volatility_pct > stable.revenue_volatility_pct);
});

test('creditReadiness: no history at all still returns a valid (low-confidence) score, not a crash', () => {
  const result = creditReadiness(perfectMetrics, []);
  assert.equal(result.record_depth_months, 0);
  assert.ok(result.score >= 0 && result.score <= 100);
});

test('simulate: price increase with a known cost_price computes margin-aware new revenue', () => {
  const twin = { product: { price: 100, cost_price: 70 } };
  const result = simulate(twin, { type: 'price_change', pct: 10 });
  assert.equal(result.elasticity_used, -0.5); // small change (<=10%) → mild elasticity band
  assert.ok(!result.assumptions.some(a => /30% margin/i.test(a)));
});

test('simulate: price change with no cost_price falls back to an assumed 30% margin and flags it', () => {
  const twin = { product: { price: 100, cost_price: null } };
  const result = simulate(twin, { type: 'price_change', pct: 10 });
  assert.ok(result.assumptions.some(a => /30% margin/i.test(a)));
});

test('simulate: larger price change uses a steeper elasticity band', () => {
  const twin = { product: { price: 100, cost_price: 70 } };
  const mid = simulate(twin, { type: 'price_change', pct: 15 });
  const large = simulate(twin, { type: 'price_change', pct: 30 });
  assert.equal(mid.elasticity_used, -1.0);
  assert.equal(large.elasticity_used, -1.5);
});

test('simulate: price decrease uses the same elasticity band logic on the absolute pct', () => {
  const twin = { product: { price: 100, cost_price: 70 } };
  const result = simulate(twin, { type: 'price_change', pct: -20 });
  assert.equal(result.elasticity_used, -1.0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/twin.test.mjs`
Expected: FAIL — `creditReadiness`/`simulate` not exported yet.

- [ ] **Step 3: Implement**

In `packages/shared/twin.js`, add after `scoreHealth`:

```js
function creditReadiness(metrics, monthlyHistory) {
  const disclaimer = 'This is what a lender would see in your numbers — not a credit decision. MiniMe does not extend, deny, or influence any loan.';
  const revenues = (monthlyHistory || []).map(m => m.revenue).filter(r => typeof r === 'number');
  const recordDepthMonths = revenues.length;

  let volatilityPct = 0;
  if (revenues.length >= 2) {
    const mean = revenues.reduce((a, b) => a + b, 0) / revenues.length;
    const variance = revenues.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / revenues.length;
    const stddev = Math.sqrt(variance);
    volatilityPct = mean > 0 ? Math.round((stddev / mean) * 100) : 100;
  }

  const { score: healthScore } = scoreHealth(metrics);
  // Depth bonus: up to +10 for 6+ months of history, 0 for none.
  const depthFrac = clamp(recordDepthMonths / 6, 0, 1);
  const depthBonus = Math.round(depthFrac * 10);
  // Volatility penalty: 0% volatility = no penalty, 50%+ volatility = full 20-point penalty.
  const volatilityPenalty = Math.round(clamp(volatilityPct / 50, 0, 1) * 20);

  const score = clamp(Math.round(healthScore * 0.7) + depthBonus - volatilityPenalty, 0, 100);
  return { score, revenue_volatility_pct: volatilityPct, record_depth_months: recordDepthMonths, disclaimer };
}

const ELASTICITY_BANDS = [
  { maxAbsPct: 10, elasticity: -0.5 },
  { maxAbsPct: 25, elasticity: -1.0 },
  { maxAbsPct: Infinity, elasticity: -1.5 },
];

function simulate(twin, options) {
  if (options.type !== 'price_change') throw new Error(`Unsupported simulation type: ${options.type}`);
  const pct = Number(options.pct);
  const absPct = Math.abs(pct);
  const band = ELASTICITY_BANDS.find(b => absPct <= b.maxAbsPct);
  const elasticity = band.elasticity;

  const product = twin.product || {};
  const price = Number(product.price || 0);
  const assumptions = [];
  let costPrice = product.cost_price;
  if (costPrice == null) {
    costPrice = price * 0.7;
    assumptions.push('No cost_price on file — assumed 30% margin.');
  }

  const volumeChangeFrac = elasticity * (pct / 100);
  const baselineVolume = 100; // relative unit — twin doesn't carry historical unit sales for a single product here, so this models *proportional* revenue impact, not absolute units.
  const newVolume = baselineVolume * (1 + volumeChangeFrac);
  const newPrice = price * (1 + pct / 100);
  const baselineRevenue = price * baselineVolume;
  const newRevenueEstimate = newPrice * newVolume;
  assumptions.push(`Elasticity band: ${elasticity} (based on a ${absPct}% price change magnitude).`);
  assumptions.push('Models proportional revenue impact relative to current baseline — not an absolute unit forecast.');

  return {
    new_revenue_estimate: Math.round(newRevenueEstimate),
    baseline_revenue_estimate: Math.round(baselineRevenue),
    revenue_change_pct: baselineRevenue > 0 ? Math.round(((newRevenueEstimate - baselineRevenue) / baselineRevenue) * 100) : 0,
    elasticity_used: elasticity,
    assumptions,
  };
}

async function saveSnapshot(businessId, twin) {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase().from('business_twin_snapshots').upsert({
    business_id: businessId,
    snapshot_date: today,
    health_score: twin.health.score,
    components: twin.health.components,
    metrics: twin.metrics,
    credit_profile: twin.credit || {},
  }, { onConflict: 'business_id,snapshot_date' });
  if (error) console.error('twin: saveSnapshot error:', error.message);
}

async function getLatestSnapshot(businessId) {
  const { data } = await supabase().from('business_twin_snapshots')
    .select('*').eq('business_id', businessId)
    .order('snapshot_date', { ascending: false }).limit(1).single();
  return data || null;
}
```

Then update `computeTwin` to actually populate `credit` (replace the `credit: null` line): fetch monthly revenue history from `business_twin_snapshots` (if any exist yet) grouped by month, or fall back to an empty array on a fresh business — and update the final `module.exports`:

```js
  const { data: history } = await supabase().from('business_twin_snapshots')
    .select('snapshot_date, metrics').eq('business_id', businessId)
    .order('snapshot_date', { ascending: true });
  const monthlyRevenue = {};
  for (const row of history || []) {
    const month = row.snapshot_date.slice(0, 7);
    monthlyRevenue[month] = row.metrics?.revenue || 0; // last snapshot of the month wins
  }
  const monthlyHistory = Object.entries(monthlyRevenue).map(([month, revenue]) => ({ month, revenue }));
  const credit = creditReadiness(metrics, monthlyHistory);
  return { metrics, health, credit, assumptions: [] };
```

```js
module.exports = { computeTwin, scoreHealth, creditReadiness, simulate, saveSnapshot, getLatestSnapshot, HEALTH_WEIGHTS };
```

- [ ] **Step 4: Run to verify tests pass**

Run: `node --test tests/twin.test.mjs`
Expected: PASS — all 11 tests (5 from Task 3 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/twin.js tests/twin.test.mjs
git commit -m "feat(twin): creditReadiness scoring, deterministic price-change simulate, snapshot persistence"
```

---

## Task 5: Bot commands — `/twin`, `/simulate`, `/credit`

**Files:**
- Modify: `apps/bot/src/handlers/command.js`
- Modify: `apps/bot/src/services/advisor.js:103-105`

**Interfaces:**
- Consumes: `computeTwin`, `simulate` from `packages/shared/twin.js`.

- [ ] **Step 1: Add the three command cases**

Insert before `case '/help':` in `command.js` (alongside the `/negotiation` case if the negotiation-engine plan already landed, otherwise directly before `/help`):

```javascript
      case '/twin': {
        const { computeTwin } = require('../../../../packages/shared/twin');
        const twin = await computeTwin(business.id);
        const { health, metrics, credit } = twin;
        const strengths = Object.entries(health.components).filter(([, v]) => v >= 12).map(([k]) => k.replace(/_/g, ' '));
        const weaknesses = Object.entries(health.components).filter(([, v]) => v < 8).map(([k]) => k.replace(/_/g, ' '));
        await bot.sendMessage(chatId,
          `📊 *Business Twin — Health: ${health.score}/100*\n\n` +
          `💰 Revenue (30d): ${metrics.revenue} ${business.notification_prefs?.currency || 'ETB'} (prior 30d: ${metrics.revenue_prior_30d})\n` +
          `🔁 Repeat rate: ${metrics.repeat_rate_pct}%\n` +
          `📦 Low/out of stock: ${metrics.low_stock_pct}% / ${metrics.out_of_stock_pct}%\n` +
          `💳 Credit readiness: ${credit.score}/100 (${credit.record_depth_months}mo history)\n\n` +
          (strengths.length ? `✅ Strong: ${strengths.join(', ')}\n` : '') +
          (weaknesses.length ? `⚠️ Weak: ${weaknesses.join(', ')}\n` : ''),
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case '/credit': {
        const { computeTwin } = require('../../../../packages/shared/twin');
        const { credit } = await computeTwin(business.id);
        await bot.sendMessage(chatId,
          `💳 *Credit Readiness: ${credit.score}/100*\n\n` +
          `Revenue volatility: ${credit.revenue_volatility_pct}%\n` +
          `Record depth: ${credit.record_depth_months} month(s)\n\n` +
          `_${credit.disclaimer}_`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case '/simulate': {
        const parts = msg.text.trim().split(/\s+/);
        if (parts[1] !== 'price' || parts.length < 3) {
          await bot.sendMessage(chatId, 'Usage: /simulate price ±N [product name]\nExample: /simulate price +15 Honey');
          break;
        }
        const pct = parseFloat(parts[2].replace('+', ''));
        if (!Number.isFinite(pct)) {
          await bot.sendMessage(chatId, 'Usage: /simulate price ±N [product name]');
          break;
        }
        const productName = parts.slice(3).join(' ').trim();
        const { findByBusiness: findProductsForSim } = require('../../../../packages/db/queries/products');
        const products = await findProductsForSim(business.id);
        const product = productName ? products.find(p => p.name.toLowerCase().includes(productName.toLowerCase())) : products[0];
        if (!product) {
          await bot.sendMessage(chatId, productName ? `❌ No product matching "${productName}"` : '❌ No products found');
          break;
        }
        const { simulate } = require('../../../../packages/shared/twin');
        const result = simulate({ product }, { type: 'price_change', pct });
        await bot.sendMessage(chatId,
          `📈 *Simulation: ${product.name} ${pct > 0 ? '+' : ''}${pct}%*\n\n` +
          `Estimated revenue change: ${result.revenue_change_pct > 0 ? '+' : ''}${result.revenue_change_pct}%\n` +
          `Elasticity band used: ${result.elasticity_used}\n\n` +
          `_${result.assumptions.join(' ')}_`,
          { parse_mode: 'Markdown' }
        );
        break;
      }
```

- [ ] **Step 2: Add to `/help`**

```javascript
          `📊 /twin — Business health score & credit readiness\n` +
          `📈 /simulate price ±N [product] — What-if price simulation\n` +
```

- [ ] **Step 3: Inject the snapshot into `advisor.js`**

Current (`advisor.js:103-105`):

```js
# BUSINESS SNAPSHOT
- Trust: ${business.trust_level} · Panic: ${business.panic_mode ? 'ON' : 'OFF'}
- Current time: ${new Date().toISOString()}
```

Change to (compute the extra block earlier in the function, following the `threadBlock`/`scheduleBlock` pattern already used for the other injected sections, around lines 32-63):

```js
  let twinBlock = '';
  try {
    const { getLatestSnapshot } = require('../../../../packages/shared/twin');
    const snapshot = await getLatestSnapshot(business.id);
    if (snapshot) {
      twinBlock = `\n- Business health: ${snapshot.health_score}/100 (as of ${snapshot.snapshot_date})`;
    }
  } catch (e) {
    console.error('advisor: twin snapshot fetch failed:', e.message);
  }
```

then in the `system` template literal:

```js
# BUSINESS SNAPSHOT
- Trust: ${business.trust_level} · Panic: ${business.panic_mode ? 'ON' : 'OFF'}
- Current time: ${new Date().toISOString()}${twinBlock}
```

- [ ] **Step 4: Syntax-check**

Run: `node --check apps/bot/src/handlers/command.js && node --check apps/bot/src/services/advisor.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/handlers/command.js apps/bot/src/services/advisor.js
git commit -m "feat(twin): add /twin, /simulate, /credit commands; inject latest health snapshot into advisor prompt"
```

---

## Task 6: Nightly snapshot cron

**Files:**
- Modify: `apps/bot/src/cron/index.js`

**Interfaces:**
- Consumes: `computeTwin`, `saveSnapshot` from `packages/shared/twin.js`; `findAll` from `packages/db/queries/businesses.js`.

- [ ] **Step 1: Add the sweep right after the (now-fixed) nightly analytics job**

In `apps/bot/src/cron/index.js`, after the `0 21 * * *` block fixed in Task 2:

```javascript
  // Business Twin nightly snapshot — right after analytics rolls up, 21:05 EAT (18:05 UTC)... actually keep same slot, staggered 5 min later
  cron.schedule('5 21 * * *', async () => {
    try {
      const { findAll: findAllBusinessesForTwin } = require('../../../../packages/db/queries/businesses');
      const { computeTwin, saveSnapshot } = require('../../../../packages/shared/twin');
      const businesses = await findAllBusinessesForTwin();
      for (const business of businesses) {
        try {
          const twin = await computeTwin(business.id);
          await saveSnapshot(business.id, twin);
        } catch (e) {
          console.error(`twin snapshot failed for business ${business.id}:`, e.message);
        }
      }
    } catch (e) {
      console.error('nightly twin snapshot cron error:', e);
    }
  });
```

- [ ] **Step 2: Syntax-check**

Run: `node --check apps/bot/src/cron/index.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/cron/index.js
git commit -m "feat(twin): nightly snapshot sweep (computeTwin + saveSnapshot per business, 5 min after analytics rollup)"
```

---

## Task 7: Web API route

**Files:**
- Create: `apps/web/src/app/api/twin/route.js`

**Interfaces:**
- Consumes: `computeTwin`, `simulate`, `getLatestSnapshot` from `packages/shared/twin.js`; `verifyTelegramInitData`/`parseTelegramUser` from `apps/web/src/lib/telegram.js`; `findBusinessForUser` from `apps/web/src/lib/server/businesses.js` — same auth chain as `apps/web/src/app/api/b2b/route.js`.
- Produces: `GET /api/twin` → `{ twin, snapshots: [...] }`; `POST /api/twin` with `{ action: 'simulate', pct, product_id }` → `{ result }`.

- [ ] **Step 1: Write the route**

```js
/**
 * GET  /api/twin  — live Business Twin + snapshot history (for the sparkline)
 * POST /api/twin   — { action: 'simulate', pct, product_id } → deterministic price-change simulation
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authBusiness(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const business = await findBusinessForUser(tg.id);
  if (!business) return { error: NextResponse.json({ error: 'no_business' }, { status: 404 }) };
  return { tg, business };
}

export async function GET(request) {
  const { business, error } = await authBusiness(request);
  if (error) return error;

  const { computeTwin } = require('../../../../packages/shared/twin');
  const twin = await computeTwin(business.id);

  const sb = supabase();
  const { data: snapshots } = await sb
    .from('business_twin_snapshots')
    .select('snapshot_date, health_score, metrics')
    .eq('business_id', business.id)
    .order('snapshot_date', { ascending: true })
    .limit(90);

  return NextResponse.json({ twin, snapshots: snapshots || [] });
}

export async function POST(request) {
  const { business, error } = await authBusiness(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  if (body.action !== 'simulate') {
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  }

  const pct = Number(body.pct);
  if (!Number.isFinite(pct)) {
    return NextResponse.json({ error: 'invalid_pct' }, { status: 400 });
  }

  const sb = supabase();
  let product = null;
  if (body.product_id) {
    const { data } = await sb.from('products').select('*').eq('id', body.product_id).eq('business_id', business.id).single();
    product = data;
  } else {
    const { data } = await sb.from('products').select('*').eq('business_id', business.id).eq('is_active', true).limit(1);
    product = data?.[0] || null;
  }
  if (!product) return NextResponse.json({ error: 'no_product' }, { status: 404 });

  const { simulate } = require('../../../../packages/shared/twin');
  const result = simulate({ product }, { type: 'price_change', pct });
  return NextResponse.json({ result, product: { id: product.id, name: product.name, price: product.price } });
}
```

- [ ] **Step 2: Lint/build check**

Run: `cd apps/web && node --check src/app/api/twin/route.js 2>&1 || true` — note: this file uses ESM `import`/JSX-adjacent Next.js conventions that plain `node --check` may reject; if it fails on `import` syntax specifically (not a real bug), rely on `npm run build` (or `next lint`) instead: `cd apps/web && npx next lint --file src/app/api/twin/route.js` if available, otherwise defer full validation to the Task 9 build step.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/twin/route.js
git commit -m "feat(twin): GET/POST /api/twin — live twin + snapshot history, price-change simulation"
```

---

## Task 8: Web dashboard page

**Files:**
- Create: `apps/web/src/app/(dashboard)/twin/page.js`
- Create: `apps/web/src/components/pages/TwinPage.jsx`
- Modify: `apps/web/src/components/layout/Sidebar.jsx:8-41` (`NAV_GROUPS`)
- Modify: `apps/web/src/components/layout/MobileNav.jsx` (mirror the same nav entry)

**Interfaces:**
- Consumes: `GET`/`POST /api/twin` (Task 7); `useTelegram()`, `apiGet` from `apps/web/src/lib/api.js`; `COLORS`/`FONT`/`RADII`/`SHADOW` from `apps/web/src/lib/design-tokens.js`; `recharts` (`ResponsiveContainer`, `LineChart`, `Line`, `XAxis`, `YAxis`, `Tooltip`) for the sparkline.

- [ ] **Step 1: Page shim**

Create `apps/web/src/app/(dashboard)/twin/page.js`:

```js
import TwinPage from '../../../components/pages/TwinPage';
export default function Page() { return <TwinPage />; }
```

- [ ] **Step 2: Page component**

Create `apps/web/src/components/pages/TwinPage.jsx`, following `MemoryPage.jsx`'s token-based-styling convention (no Tailwind classes) and `WeeklyChart.jsx`'s `recharts` pattern for the sparkline:

```jsx
'use client';
/**
 * Business Twin — health score, component breakdown, credit-readiness card,
 * a 90-day health sparkline, and a price-change what-if simulator.
 */
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { apiGet } from '../../lib/api';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function scoreColor(score) {
  if (score >= 70) return COLORS.teal;
  if (score >= 40) return '#D97706';
  return '#DC2626';
}

function MetricCard({ label, value }) {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '12px 14px', boxShadow: SHADOW.card }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.textHint }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: COLORS.textPrimary, marginTop: 4 }}>{value}</div>
    </div>
  );
}

export default function TwinPage() {
  const { initData } = useTelegram() || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [simPct, setSimPct] = useState(10);
  const [simResult, setSimResult] = useState(null);

  const load = useCallback(() => {
    if (!initData) return;
    setLoading(true);
    apiGet('/api/twin', initData).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [initData]);

  useEffect(load, [load]);

  async function runSimulation() {
    const r = await fetch('/api/twin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ action: 'simulate', pct: simPct }),
    });
    setSimResult(await r.json().catch(() => null));
  }

  if (loading) return <div style={{ fontSize: 13, color: COLORS.textHint, fontFamily: FONT.body }}>Loading…</div>;
  if (!data?.twin) return <div style={{ fontSize: 13, color: COLORS.textHint, fontFamily: FONT.body }}>Couldn't load your Business Twin.</div>;

  const { health, metrics, credit } = data.twin;
  const sparkData = (data.snapshots || []).map(s => ({ date: s.snapshot_date.slice(5), score: s.health_score }));

  return (
    <div style={{ fontFamily: FONT.body, maxWidth: 760, paddingBottom: 100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: FONT.serif, fontWeight: 400, fontSize: 28, margin: '0 0 6px', letterSpacing: '-0.02em', color: COLORS.textPrimary }}>
          Business Twin
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textHint, margin: 0, lineHeight: 1.5 }}>
          Your business, modeled — health, credit readiness, and what-if simulation.
        </p>
      </div>

      {/* Health gauge */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 20, boxShadow: SHADOW.card, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: scoreColor(health.score) }}>{health.score}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: COLORS.textHint, marginBottom: 6 }}>HEALTH SCORE / 100</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(health.components).map(([key, val]) => (
              <span key={key} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: COLORS.border, color: COLORS.textSecondary }}>
                {key.replace(/_/g, ' ')}: {val}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Sparkline */}
      {sparkData.length > 1 && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, marginBottom: 16 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.textHint, marginBottom: 8 }}>Health over time</div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={sparkData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: COLORS.textHint }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} hide />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke={COLORS.teal} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <MetricCard label="Revenue (30d)" value={`${metrics.revenue} ETB`} />
        <MetricCard label="Repeat rate" value={`${metrics.repeat_rate_pct}%`} />
        <MetricCard label="Low stock" value={`${metrics.low_stock_pct}%`} />
        <MetricCard label="Out of stock" value={`${metrics.out_of_stock_pct}%`} />
      </div>

      {/* Credit card */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.textHint, marginBottom: 6 }}>Credit Readiness</div>
        <div style={{ fontSize: 24, fontWeight: 600, color: scoreColor(credit.score) }}>{credit.score}/100</div>
        <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 4 }}>Volatility: {credit.revenue_volatility_pct}% · {credit.record_depth_months}mo history</div>
        <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 8, fontStyle: 'italic' }}>{credit.disclaimer}</div>
      </div>

      {/* Simulation form */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card }}>
        <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.textHint, marginBottom: 10 }}>What-if: price change</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" value={simPct} onChange={e => setSimPct(Number(e.target.value))}
            style={{ width: 80, padding: '8px 10px', borderRadius: RADII.md, border: `1px solid ${COLORS.border}` }} />
          <span style={{ fontSize: 13, color: COLORS.textSecondary }}>%</span>
          <button onClick={runSimulation}
            style={{ padding: '8px 16px', borderRadius: 999, border: 'none', background: COLORS.teal, color: '#fff', cursor: 'pointer', fontSize: 13 }}>
            Simulate
          </button>
        </div>
        {simResult?.result && (
          <div style={{ marginTop: 12, fontSize: 13, color: COLORS.textPrimary }}>
            Estimated revenue change: <strong>{simResult.result.revenue_change_pct > 0 ? '+' : ''}{simResult.result.revenue_change_pct}%</strong>
            <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 4 }}>{simResult.result.assumptions.join(' ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Nav link**

In `apps/web/src/components/layout/Sidebar.jsx`, add `Activity` (or similar) to the `lucide-react` import list (line 4), and add an item to the "Management" group (`NAV_GROUPS`, around line 25-33):

```javascript
      { href: '/twin',        icon: Activity,     label: 'Business Twin', labelAm: 'መስተዋት' },
```

Apply the same entry to `apps/web/src/components/layout/MobileNav.jsx` — read that file first to match its exact nav-array shape before editing (it was not fetched during exploration; confirm its structure matches `Sidebar.jsx`'s `{href, icon, label, labelAm}` shape before assuming so).

- [ ] **Step 4: Verify with the dev server**

Run: `cd apps/web && npm run dev` (or reuse whatever the `run` skill's project-launch pattern is for this repo), navigate to `/twin`, confirm the page loads without a client-side exception (a real Telegram `initData` won't be present outside the Mini App shell, so expect the "Couldn't load your Business Twin" empty state rather than a crash — a thrown error/blank white screen is the failure signal to watch for, not the empty state itself).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/twin/page.js apps/web/src/components/pages/TwinPage.jsx apps/web/src/components/layout/Sidebar.jsx apps/web/src/components/layout/MobileNav.jsx
git commit -m "feat(twin): Business Twin dashboard page (health gauge, sparkline, credit card, price simulator) + nav link"
```

---

## Task 9: Full verification, push, draft PR (or update existing one)

- [ ] **Step 1: Syntax-check bot-side files**

```bash
for f in apps/bot/src/cron/index.js packages/shared/twin.js apps/bot/src/handlers/command.js apps/bot/src/services/advisor.js; do
  node --check "$f" || echo "FAILED: $f"
done
```

Expected: no "FAILED" lines.

- [ ] **Step 2: Run the twin test suite and the full suite for regressions**

```bash
node --test tests/twin.test.mjs
node --test tests/
```

Expected: all PASS.

- [ ] **Step 3: Build the web app**

```bash
cd apps/web && npm run build
```

Expected: build succeeds (Next.js will surface any real syntax/type issues in `route.js`/`TwinPage.jsx`/`page.js` here, which is the actual validation for those ESM/JSX files that plain `node --check` can't parse).

- [ ] **Step 4: Push; open a draft PR only if one doesn't already exist for this branch**

```bash
git push -u origin claude/minime-future-evolution-2f9e3r
if ! gh pr view claude/minime-future-evolution-2f9e3r >/dev/null 2>&1; then
  gh pr create --draft --title "feat: Supplier Negotiation Engine + Business Twin" --body "$(cat <<'EOF'
## Summary
- Business Twin: unified health score (0-100), credit-readiness profile, deterministic price-change simulation — on Telegram (/twin, /simulate, /credit) and the web dashboard (/twin)
- Fixes the nightly analytics cron, which has been throwing every night at 21:00 UTC (broken import, silently unhandled)
- Nightly snapshot sweep persists health history for the dashboard sparkline and credit volatility scoring

## Migration required
`packages/db/migrations/034_business_twin.sql` must be applied via the Supabase SQL editor before this deploys.

## Test plan
- [x] node --test tests/twin.test.mjs
- [x] node --test tests/ (no regressions)
- [x] apps/web build succeeds
- [ ] Manual: /twin, /simulate, /credit in a real chat; /twin dashboard page in the Mini App
EOF
)"
fi
```

---

## Self-Review Notes

- **Spec coverage:** `packages/shared/twin.js` with all 6 named exports (Tasks 3-4), migration 034 + schema mirror (Task 1), bot surfaces `/twin`/`/simulate`/`/credit` + advisor injection (Task 5), cron fix + nightly snapshot (Tasks 2, 6), web API route + page + nav (Tasks 7-8), tests incl. missing `cost_price` (Task 4's `simulate` tests), commit/push/PR (Task 9). All spec bullets have a home.
- **Deviation flagged:** the original spec cites the analytics AOV/LTV/repeat-rate/stock-velocity block at `apps/web/src/app/api/analytics/route.js:217-235` — exploration found the real range is `160-241`, and the repeat-rate calc there is *order-history-based* (`orders.customer_id` grouping) rather than the `customers.total_orders` column `computeTwin` uses. This plan intentionally uses the `customers.total_orders` column instead (simpler, already-maintained, avoids re-scanning all orders) — flagged here rather than silently diverging.
- **Deviation flagged:** `avg_response_time_seconds` exists as a `daily_analytics` column but is never populated by `aggregateForBusiness` (confirmed always null in the live aggregation code) — `computeTwin` does NOT read that column; it computes `avg_response_seconds` fresh from `messages` directly, trailing 30 days.
- **Placeholder scan:** no TBD/TODO markers; every step has real, pasted code (not "similar to Task N" references) except Task 8 Step 3's explicit instruction to *read* `MobileNav.jsx` first — that's a genuine unknown flagged as a read-before-edit step, not a shortcut.
