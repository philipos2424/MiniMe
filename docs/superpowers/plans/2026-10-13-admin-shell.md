# Admin Today implementation plan

Scope approved in chat: ship Today and the missing-rollup Pulse alert first.
Base: origin/main (2411b07). Preserve legacy tools at /admin/legacy.

## Constraints

EAT days; shared metric definitions; exclude internal shops; chain AI calls
only; stable paginated list reads; no tracking or new migrations. V2 responses
contain aggregates only. Admin session and Telegram auth stay server-enforced.
No production deployment as part of this implementation.

## Files

| File | Responsibility |
| --- | --- |
| lib/server/metrics/definitions.mjs | Today aggregates and units/periods |
| lib/server/metrics/freshness.mjs | Latest successful run and Pulse warning |
| lib/server/metrics/today.mjs | Independent paginated panel reads |
| app/api/admin/v2/today/route.js | Authenticated read-only API |
| app/admin/today/* | Responsive Today screen and isolated panel states |
| app/admin/legacy/page.js | Preserved legacy tools with hash deep links |
| app/api/admin/pulse/route.js | Shared freshness alert |
| lib/server/__tests__/adminToday.test.mjs | Data, errors, privacy, freshness |

## Steps and review focus

- [x] Write failing tests for missing/stale/failed runs, EAT boundaries,
      exclusion of internal/deleted shops and raw/summary AI rows, no-data
      states, pagination, failed reads, and aggregate-only responses.
- [x] Implement shared definitions and panel loader. Today signups compare
      with the full same weekday last week from platform_daily, explicitly
      labelled as a full day (hourly historical rollups do not exist).
- [x] Build Today and preserve the legacy page. Each panel fetches separately
      and offers its own retry; auth failures offer sign-in.
- [x] Add the same missing/stale warning to legacy Pulse.
- [x] Run focused tests, full npm test and production compilation; review diff.

## Validation

- 22 focused Today/metric tests pass, including runtime route auth and isolated
  failures; private database errors are not returned to the client.
- Production Next.js build passes (restricted-network font download warning).
- Full suite: 408 pass, 3 fail. All three failures reproduce in the unchanged
  onboarding.test.mjs suite and concern teaching/FAQ storage errors and currency
  extraction. Its source files are identical to origin/main.
- Built /admin, /admin/today, /admin/legacy return HTTP 200; anonymous v2 calls
  return 403 with no-store. Browser smoke check confirms the new layout and
  admin sign-in prompts. Authenticated live data was not exercised locally.

## Deferred

Money, Growth, Shops, AI & Ops, Trust & Privacy, roles/reveal and canMessage
remain later work. No trend charts in this slice, so no backfill line styling;
the historical comparison explicitly labels backfilled data and limits.
Webhook panel reports observed custom-bot delivery failures, not a live
Telegram configuration probe. Provider attribution is deferred: chain rows
do not reliably identify the failing provider. Existing legacy payment
approval semantics (including permanent Pro grants) are unchanged.
