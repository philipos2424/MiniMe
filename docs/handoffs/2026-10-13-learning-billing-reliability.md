# Learning and billing reliability repairs

Scope: the next two priorities approved in chat: fix the three learning test
failures, then correct concrete billing inconsistencies on main. No production
data changes or migrations were applied.

## Learning

- Reproduced all three failures on main (2411b07).
- Business knowledge and semantic FAQ documents check chunk and status writes.
  Failed documents are not marked ready. Failed FAQ reads do not overwrite
  existing instructions, and failed writes surface to the caller.
- Catalog extraction accepts supported currency codes before/after amounts and
  preserves the stated currency. Failed brief storage stops catalog mutations.
- Learning-only full suite: 408/408 pass; production build passes.

## Billing

- Server and client use the same entitlement helper. Finite subscriptions obey
  their expiry even with plan_tier=pro. Explicit legacy no-expiry Pro grants
  remain valid unless cancelled/expired. Active rows with no tier/expiry no
  longer imply Pro (the old billing-sync failure state).
- Dashboard and Telegram manual-payment review share period selection and
  conditional writes. Monthly/quarterly/annual mean 1/3/12 calendar months,
  preserving a later existing expiry and clamping month ends in UTC.
- Unknown historical periods require selection in the dashboard after reviewing
  the proof. Monthly trust-based spot checks do not grant time a second time.
- Stale payment references and concurrent decisions fail with a refresh message.
  New Telegram buttons include a payment-reference digest; old buttons send
  admins to the dashboard instead of acting on an ambiguous submission.
- Rejection preserves an existing paid/trial entitlement; provisional monthly
  access is revoked. Rejections are audited, not counted as paid churn.
- Generic business PATCH no longer verifies payments; the review endpoint must
  be used. Failed verification/proof writes cannot send a success notification.

## Validation and release notes

- Full suite after both repairs: 416 tests pass, zero failures.
- Payment tests cover periods, month ends, expiry, shared server/client access,
  legacy grants, unknown periods, rejection, concurrency, stale references,
  admin authorization and failed writes without success notifications.
- B2B autonomy's Pro fixture now explicitly sets plan_tier=pro; its assertions
  are unchanged.
- The new review endpoint performs the existing payment action and requires
  admin authentication; no live payment decisions were made during testing.
- Finite expired subscriptions will correctly lose Pro access upon release.
  Legacy Telegram approval buttons must be handled from the dashboard.

## Remaining work

This is not a migration to the other branch's payment_state schema. Reconcile
that schema separately, with an inventory of live rows and a migration plan.
Gateway crediting still needs a transactional payment ledger for durable
exactly-once handling of simultaneous callbacks; existing claim/event-log
code is not an atomic transaction. Trust-based monthly proof activation still
needs prior-entitlement snapshots for precise reversal of early renewals.
The wider reporting, privacy, canMessage and rate-limit roadmap remains open.
