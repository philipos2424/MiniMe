# Admin Dashboard Rebuild — Design

**Date:** 2026-10-13
**Status:** Draft, awaiting review
**Scope:** `/admin` (platform admin). The owner-facing dashboard is out of scope.

## 1. Purpose

The platform admin (primary user: the founder; secondary: one analyst admin)
needs one place to see the whole platform: is anything broken, is money coming
in, how shops behave, and where they drop off — with full analytics behind each
answer.

The current `/admin` (`apps/web/src/app/admin/page.js`, 4,691 lines, 21 tabs,
~30 `/api/admin/*` routes) computes the same metrics differently in different
routes. That is how the "granted (unpaid)" bucket came to include brand-new
trial shops: `deductCreditAndLogUsage` in `lib/server/billing.js` copies
`subscriptions.status` (column default `'active'`) onto
`businesses.subscription_status`, giving every shop that uses an AI credit
active-with-no-expiry, which `planStatus()` and `paymentState()` read as Pro.

### Success criteria

- Every section answers one stated question; no panel without one.
- Every number has a single definition in code, a unit, and a comparison period.
- No number on screen is known to be wrong (the granted bucket reconciles).
- Personal data is masked unless deliberately revealed; every reveal is logged.
- Messaging tools cannot reach anyone who opted out or never started the bot.

### Decisions already made

| Decision | Choice |
|---|---|
| Which dashboard | Admin only |
| Depth | Restructure **and** rebuild pages + data layer |
| Behaviour scope | Owners, buyer aggregates, and individual buyers (gated) |
| Computation | Nightly rollup tables in Supabase + live "today" queries |
| Third-party analytics | None (no new data processor) |

## 2. Sub-projects and order

Each gets its own implementation plan.

1. **Metric truth** — billing sync fix + data repair, `is_internal` flag,
   definitions module, rollup tables, nightly cron, backfill.
2. **Dashboard shell + sections** — new `/admin` with six sections, legacy kept
   at `/admin/legacy`.
3. **Privacy layer** — roles, server-side masking, reveal, exports, retention
   panel, data-subject request queue.
4. **Messaging rules** — unified `canMessage()` gate and dashboard reporting.

The legacy page is deleted only after the owner confirms the new one covers
everything they use.

## 3. Architecture

```
raw tables ──► lib/server/metrics/definitions.js ──┬─► cron /api/cron/metrics-rollup
                                                   │     → shop_daily, platform_daily
                                                   └─► live "today" queries
                                                              │
                                  /api/admin/v2/<section>  (read-only, masked)
                                  /api/admin/v2/reveal     (owner role, logged)
                                                              │
                                  /admin/<section>/ (small files per section)
```

### 3.1 Definitions module

`apps/web/src/lib/server/metrics/definitions.js` (pure functions + SQL
fragments) is the only place a metric is defined. Both the cron and the live
queries import it. `paymentState` and `planStatus` stay where they are and are
re-exported, not duplicated.

Core definitions:

| Term | Definition |
|---|---|
| internal shop | `businesses.is_internal = true`; excluded from every metric |
| live shop (period) | bot handled ≥1 inbound customer message in the period |
| engaged owner (period) | ≥1 owner session in `ux_events` in the period |
| entitled | `planStatus()` grants Pro |
| paying | `paymentState()` ∈ {paid, claimed} |
| MRR | sum of active paid/claimed subscriptions normalised to monthly, ETB |
| activated | first customer conversation within 7 days of signup |
| day | `(ts AT TIME ZONE 'Africa/Addis_Ababa')::date` |

Currency: ETB is the reporting currency. Payments recorded in USD are converted
with one configured rate (`METRICS_USD_ETB`), and the rate in use is shown on
the Money page.

### 3.2 Tables

New:

- `businesses.is_internal boolean not null default false`
- `shop_daily (business_id uuid, day date, …metrics…, source text, computed_at timestamptz, primary key (business_id, day))`
  — counts and states only: inbound/outbound messages, customers new/returning,
  orders, first-reply latency (median seconds), owner sessions, AI calls, AI
  cost, credits used, failed deliveries, plan state, payment state,
  onboarding stage. No names, phones, handles or message text.
- `platform_daily (day date primary key, …totals…, source text, computed_at timestamptz)`
  — includes pre-business funnel counts from `signup_sessions` (counts only).
- `metrics_rollup_runs (id, started_at, finished_at, days_covered daterange, shops_ok int, shops_failed int, error text)`

Size: ~1,300 shops × 365 ≈ 475k `shop_daily` rows/year. No partitioning.

### 3.3 Rollup job

- `GET /api/cron/metrics-rollup`, nightly 02:00 EAT, `CRON_SECRET`-gated.
- Recomputes the last 3 days via upsert on the primary key (idempotent; late
  payments and approvals land on the right day).
- Processes shops in batches; a failing shop is logged and skipped.
- Writes a `metrics_rollup_runs` row. A failed run, or none in 26 h, raises a
  Pulse alert.
- Must run nightly: `ux_events` are purged at 90 days by
  `/api/cron/data-retention`, so owner-session counts must be captured first.

### 3.4 Backfill

One-off script, rows marked `source='backfill'`, rendered as dashed lines.

Limits, stated on the charts:
- `ux_events`: last 90 days only.
- `messages`: last 18 months (older ones are archived).
- Historical plan state: reconstructed from `subscription_events`, approximate.

### 3.5 New measurement (only where none exists)

Already available: owner sessions (`/api/track` → `ux_events`), blocked-bot
detection (`telegram-send.mjs`). Derived in the rollup from existing tables:
first-reply latency, first order per shop, failed deliveries per day. No new
client-side tracking calls.

## 4. Sections

Each section loads independently; a failing query renders an error card for
that panel only. Every page shows "data as of …".

1. **Today** — *Is anything broken or waiting on me?*
   Signups today vs same weekday last week · live shops (24 h) · AI failure
   rate (`llm_call_log` ok=false, non-raw) by provider · bots with failing
   webhooks · payments awaiting review (existing actions) · rollup freshness.
2. **Money** — *Is money coming in, and how reliably?*
   MRR · paying shops · new paid · renewals due 7 d · paid churn · ARPU ·
   revenue by method · wanted-to-pay leads · entitlement-vs-payment
   reconciliation split by cause (legacy `plan_tier='pro'`, admin grant, sync
   bug) · AI cost per paying shop · gross margin.
3. **Growth & behaviour** (core) — *Where do shops drop off?*
   Funnel: signup started → each onboarding step → bot connected → first
   customer message → first order → trial end → paid; per step conversion %,
   median time, and the list of shops stuck there · weekly signup cohorts,
   engaged retention weeks 1–12 · activation rate · DAU/WAU/MAU owners and
   stickiness · feature adoption from `ux_events` · acquisition source ·
   churn-exit reasons.
4. **Shops** — *What is each shop experiencing?*
   Searchable, masked list with health score · shop drawer with event
   timeline · buyer aggregates per shop (customers, returning %, messages,
   orders, reply latency, opt-outs) · individual buyer journey via reveal only.
5. **AI & Ops** — *Is the system healthy and what does it cost?*
   LLM calls, cost, p50/p95 latency, failure by provider · credits · search
   quality and knowledge gaps · outreach and re-engagement outcomes · rollup
   job status.
6. **Trust & Privacy** — *Are we compliant?* Retention status, data-subject
   request queue, audit log, opt-out and block rates (see §5, §6).

Out of scope: live auto-refresh, custom report builder, per-buyer charts.

## 5. Privacy (GDPR)

### Roles

- `ADMIN_TELEGRAM_IDS` (existing): everyone with admin access.
- `ADMIN_OWNER_IDS` (new): subset with the `owner` role. Others are `analyst`.
  If unset, nobody has the `owner` role (no reveals) — fail closed.

| Capability | owner | analyst |
|---|---|---|
| All aggregate sections | ✓ | ✓ |
| Masked shop/buyer lists | ✓ | ✓ |
| Reveal personal data | ✓ | — |
| Personal-data export | ✓ | — |
| Execute erasure | ✓ | — |
| Aggregate CSV/PDF export | ✓ | ✓ |

### Masking (server-side, in `/api/admin/v2/*`)

Names → initial + shop name; phones → `+251 ••• ••12`; Telegram IDs → short
hash; @handles hidden; message text never in list responses.

### Reveal

`POST /api/admin/v2/reveal { subject_type, subject_id, fields[], reason, note }`

- `owner` role only; `reason` ∈ {support, abuse, dsar, payment_dispute}; `note`
  required.
- Writes `audit_logs` (actor, subject, fields, reason, note).
- Response is `Cache-Control: no-store` and used for that view only.
- No step-up auth: admin access already requires Telegram initData signature
  plus admin session.

Impersonation and personal-data exports keep their existing audit logging.

### Retention panel

Per data class: retention period, last purge run, and anything overdue, read
from `/api/cron/data-retention` results. Current policy: messages archived at
18 months, agent_thoughts 6 months, webhook_dedupe 30 days, webhook_events and
ux_events 90 days, orders never, audit_logs ≥ 2 years.

### Data-subject requests

Queue with lookup by Telegram ID or phone, covering buyers and owners. Each
request records received date and a due date (+30 days).

- Buyer: existing `customers/[id]/export` and `customers/[id]/erase`.
- Owner: existing `businesses/export` and `businesses/delete`; their
  `shop_daily` rows are re-keyed to a random UUID so aggregates survive and the
  link to the person is removed.
- Buyer erasure does not touch rollups — they contain no buyer-level rows. Do
  not add buyer identifiers to rollup tables.

## 6. Telegram messaging rules

Opt-outs exist today in three shapes: owners
(`notification_prefs.owner_nudges.opted_out`, `owner_dm_blocked`), buyers
(`customers.broadcast_opted_out`), searchers (searcher opt-out table).

`canMessage(recipient, purpose)` becomes the single gate used by broadcast,
outreach, owner nudges, and re-engagement. It enforces:

- recipient has started the bot;
- not opted out, not blocked; a `blocked: true` send result is persisted as an
  opt-out (as `telegram-send.mjs` already requires);
- marketing messages carry an unsubscribe line;
- ≤ 25 msg/s per bot and `retry_after` honoured.

Dashboard: opt-out and block rates per campaign; pre-send preview of reachable
vs excluded with reasons. Until sub-project 4 ships, per-shop opt-out figures
are labelled "partial".

## 7. Data repair (sub-project 1)

1. Stop `deductCreditAndLogUsage` from writing `subscription_status` and
   `plan_tier` to `businesses`.
2. Migration (reviewed and approved before running): shops with
   `plan_tier <> 'pro'`, `subscription_status = 'active'`,
   `subscription_expires_at IS NULL`, no payment evidence, and a matching
   free-plan `subscriptions` row → `subscription_status = 'trial'`, keeping
   their `trial_ends_at`. Fifteen shops matched on 2026-10-12.
3. The ~610 legacy `plan_tier='pro'` grants are surfaced in the Money
   reconciliation panel; what to do with them is a separate business decision.

## 8. Testing

`node --test` `.mjs`, matching the repo:

- each definition against fixtures (including internal-shop exclusion);
- rollup idempotency: running twice yields identical rows;
- EAT day boundaries (21:00 UTC rolls to the next day);
- analyst-role responses from every `/api/admin/v2/*` route contain no phone,
  Telegram ID, or name patterns;
- reveal without reason → 400; analyst reveal → 403; every reveal writes
  `audit_logs`;
- `canMessage` rejects every opt-out shape and never-started recipients;
- billing: a credit deduction no longer changes `businesses.subscription_status`.
