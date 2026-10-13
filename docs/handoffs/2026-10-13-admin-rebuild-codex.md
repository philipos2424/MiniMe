# Handoff: Admin Dashboard Rebuild, Sub-project 2 (for Codex)

**Date:** 2026-10-13
**From:** Claude Code session
**Repo:** `philipos2424/MiniMe` · app in `apps/web` (Next.js App Router, Supabase, Vercel)
**Supabase project:** `hbmesjhkczhqpbdseifd`

## Read these first

1. `docs/superpowers/specs/2026-10-13-admin-dashboard-rebuild-design.md` is the
   full design. Sections 3 and 4 cover your task.
2. `docs/superpowers/plans/2026-10-13-metric-truth.md` is sub-project 1, which
   is finished. Its "Global Constraints" apply to you as well.
3. `apps/web/src/lib/server/metrics/definitions.mjs` and `rollup.mjs` are the
   only place where metrics are defined. Import from them and don't redefine
   anything.

## Where things stand

- **The legacy `/admin` works and must stay working.**
  `apps/web/src/app/admin/page.js` is about 4,700 lines with 21 tabs and around
  30 `/api/admin/*` routes. Nothing has been deleted.
- **Sub-project 1 (metric truth) is done and live in production.**
  - Migrations `060_metrics_rollup` and `061_repair_trial_status_sync` are
    applied. The `060` migration added `businesses.is_internal`,
    `shop_daily`, `platform_daily` and `metrics_rollup_runs`.
  - The cron `GET /api/cron/metrics-rollup` runs at 23:00 UTC (02:00 EAT) and
    is configured in `apps/web/vercel.json`.
  - First run: 2026-10-12 23:01 UTC, `ok=true`. It wrote 4,113 `shop_daily`
    rows and 400 `platform_daily` days (the backfill) up to 2026-10-13.
  - All 15 stripped trials were repaired (15 rows in `audit_logs` with
    `action='billing.trial_status_repair'`).
  - Credit deduction no longer writes `subscription_status` or `plan_tier`.
- **Sub-projects 2, 3 and 4 have not started.** `/api/admin/v2` does not
  exist, there is no section shell, and there is no `canMessage()`.

## Your task: sub-project 2 (dashboard shell and six sections)

Write a plan first, saved as `docs/superpowers/plans/2026-10-13-admin-shell.md`
in the same style as the metric-truth plan (TDD steps, a file table, review
focus). Then implement it.

Scope, from spec sections 2 to 4:

1. Move the current page to `/admin/legacy` unchanged, and link to it from the
   new shell. Don't delete it: the owner removes it only after confirming the
   new dashboard covers everything they use.
2. Make a new `/admin` shell with six sections: **Today, Money, Growth &
   behaviour, Shops, AI & Ops, Trust & Privacy**. Keep one small file per
   section under `apps/web/src/app/admin/<section>/`.
3. Add read-only routes `GET /api/admin/v2/<section>`. They read
   `shop_daily`/`platform_daily` for history and use live queries only for
   "today". Reuse the existing admin auth (Telegram initData plus admin
   session) the same way the current `/api/admin/*` routes do.
4. Each panel loads on its own. When a query fails, show an error card for that
   panel only. Every page shows "data as of …", taken from the newest
   successful `metrics_rollup_runs` row.
5. Add a Pulse alert for when the newest successful rollup is older than
   `STALE_AFTER_HOURS` (26). Today the cron only alerts on a run that failed,
   not on one that never happened.
6. Draw backfilled rows (`source='backfill'`) as dashed lines, and state the
   data limits on each chart: `ux_events` 90 days, `messages` 18 months,
   historical plan state approximate.

Out of scope: sub-project 3 (roles, masking, reveal, DSAR) and sub-project 4
(`canMessage`). Until sub-project 3 ships, no v2 list response may include
phone numbers, Telegram IDs, @handles or message text. Show shop names and
masked owner initials only. That way sub-project 3 adds a reveal feature and
doesn't have to fix a leak.

## Constraints (not negotiable)

- **Day = EAT.** Use `dayKeyEAT` and never `toISOString().slice(0,10)`.
- **Internal shops are excluded** from every number (`isInternal()`).
- **LLM metrics count chain calls only.** Exclude `route` values starting with
  `raw:` (`isChainCall()`). A `$0` AI cost is normal because replies run on
  free-tier Gemini/Groq. The health signal is `llm_call_log.ok=false` on
  non-raw rows.
- **Every Supabase list read** goes through `fetchAllRows` with a stable
  `.order()`, because responses are capped at 1,000 rows.
- **Each metric has one definition in code**, plus a unit and a comparison
  period. If you need a new metric, add it to `definitions.mjs` with a test.
- **No third-party analytics** and no new client-side tracking calls.
- **Tests:** `cd apps/web && node --test src/lib/server/__tests__/<file>.test.mjs`.
  Keep pure logic in `.mjs` so it can be tested without Next.js.
- **Stage only the files your task touches.** The working tree has unrelated
  uncommitted changes by the owner (`lib/server/openaiClient.js`, three test
  files, `providerCompletion.test.mjs`, `brag-output/`, `marketing/`,
  `docs/DIMTS_INTEGRATION.md`). Don't stage or revert them.
- Don't apply migrations or push to production without the owner's go-ahead.

## Branch warning: read before you start

Production now deploys from **`main`** — **build on `main` (owner decision, 2026-10-13)**. The latest production deploy is
`d026011` on `main`. Before that, production was built from
`feat/swap-barter`. The two branches have diverged: about 48 commits exist only
on `main` and about 114 only on `feat/swap-barter`. They hold different
implementations of payment state (`main` uses `fulfill_subscription_purchase`
and `verifiedPayment`; the branch uses `payment_state` and
`isAwaitingDecision` from `lib/paymentLifecycle.js`).

The metrics modules, cron route and billing fix are **identical on both**.

These admin fixes exist **only on `feat/swap-barter`**, so the admin running in
production lacks them:

- `c779483` changes the Pulse alert to fire on AI provider failures instead of
  a zero AI cost. Production still raises a false "AI silent" alert.
- `b10b831` makes Pulse compare against the same time yesterday.
- `3e1a4f4`: the admin "Activate Pro +30d" button sets `plan_tier='pro'`, which
  `planStatus()` reads with no expiry. **On `main` this button grants Pro for
  life.**
- `churn-exit` and `notify-owners/engagement` routes, and
  `isAwaitingDecision` in payment review.

**Update, 2026-10-13:** the owner chose **`main`** as the base branch. The
+30d grant and the Pulse AI-failure alert are now fixed on `main` (branch
`fix/admin-grant-expiry`). **Don't port the rest as part of this task.**
Reconciling the two payment-state models is separate work. Branch from `main`,
open a PR, and don't push straight to `main`, because it deploys to production.

One related gap remains on `main`: approving a pending payment in the legacy
admin sets `plan_tier='pro'` with no expiry. Leave it for now, because on `main`
a real payment approval is meant to grant Pro. Mention it in your PR so the
owner can decide.

## Done means

- The plan file is written and committed.
- `/admin` shows the six sections against real rollup data, and
  `/admin/legacy` behaves exactly as `/admin` did before.
- The full suite passes: `cd apps/web && npm test`.
- Tests cover these cases:
  - every v2 route's JSON contains no phone, Telegram ID or @handle patterns;
  - internal shops are excluded;
  - an empty or stale rollup shows the stale banner and alert, and doesn't
    crash.
- The PR description lists anything in the spec that you deferred.
