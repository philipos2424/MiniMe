# Guided onboarding release

## Implemented

The live `/onboarding` route now uses the guided business → knowledge → reply preview → profile → activation flow. `/onboarding?preview=1` replays it without mutations for authenticated owners. The development-only `/design-preview/onboarding` route runs without Telegram or backend calls, clearly labelled as a prototype. Prototype replies illustrate the entered answer; they are not generated AI responses.

Private email/phone and country are stored in `business_onboarding`, not on broadly shared business records. Only the authenticated owner can read/update them through `/api/onboarding/progress`. Private contacts can be edited or cleared in Settings → Profile, exported by the owner (not staff), and are erased on account deletion. Completed screens are stored on the server; unfinished inputs are cached on the owner's device for seven days and cleared on successful activation. No private input is included in v2 funnel telemetry.

Reply previews use expiring, owner-bound database tokens, so editing works across serverless workers. Live messages/conversations are never created by the preview. An expired token requires preparing a new preview; unsaved correction text remains in the local draft.

## Before deploying

1. Apply `packages/db/migrations/057_guided_onboarding.sql` through the normal database migration process **before** deploying the code. This creates the private profile and reply-preview tables with RLS and service-only privileges. No live database was migrated during implementation.
2. Deploy the application and smoke-test with a designated Telegram test account: signup → text teaching → generated reply → correction → profile save → activation. Also test photo/PDF teaching and a network interruption. Actual AI, database, and Telegram integration must be tested in staging; local prototype tests do not exercise them.
3. Confirm the configured platform bot username produces the intended customer deep link. Verify the trial disclosure against the deployed plan rules. The shared 30-day constant is used by both activation endpoints and the onboarding copy.
4. Keep this release out of broad rollout until the five-owner study below passes. Roll back the application if failures rise; the additive private tables may remain in place for retained drafts.

## Five-owner usability study — pending participants

Include product sellers, service providers, and small-phone users. Give each person a realistic business to set up; do not explain the interface or coach them. Use representative sample information in the prototype.

Tasks: set up the business, add a useful fact, inspect and correct a reply, complete private contacts if desired, explain activation, and find the customer link. Have one person skip teaching. Ask after completion: What does MiniMe know? Which conversations can it answer? Who sees the email/phone? What happens after the trial? Where would you fix a wrong answer?

Acceptance: at least 4/5 finish without coaching; 5/5 understand activation and private contacts; at least 4/5 explain saved knowledge and find correction. Revise any repeatedly misunderstood screen before release. Record completion, confusing wording, misclicks, requests for help, and device size. These results have not been claimed or fabricated.

## Measurement

Use `v2_business`, `v2_offer`, `v2_answer`, `v2_preview`, `v2_location`, `v2_contact`, `v2_review`, and `v2_success` for new-flow screens. `v2_stage_completed`, `v2_teaching_skipped`, `v2_knowledge_saved`, `v2_preview_shown`, `v2_answer_corrected`, `v2_contact_saved`, `v2_error`, and `v2_link_copied` describe actions. Metadata is restricted to screen names, bounded elapsed milliseconds, and whether optional contacts were supplied; never actual values.

Compare unique-owner cohorts by signup date against the preceding funnel. Count completion using `connected_shared`, which remains emitted for compatibility. Measure first-preview time using each owner's first `v2_preview_shown`; contact completion is optional and should not become a mandatory optimization target. Track first real inbound customer messages and owner activity at day seven using existing messages and authenticated activity events. Report skipped teaching separately from successful personalized previews. Low-volume usability evidence takes priority over claiming statistically significant conversion improvement.

## Local verification

- Production build and server tests run locally; build reports existing Sentry/OpenTelemetry and unpdf bundling warnings.
- Browser walkthrough: business → teaching → preview → correction → Kenya/KES → private contact → review edit → success; separate India/INR path with teaching and contacts skipped.
- Privacy tests exercise two-owner separation, metadata filtering, SQL role restrictions, persistence failure, and deletion cascades. Additional tests cover global currency preservation, failed knowledge storage, correction failure, and previews across separate workers.
- The five-owner study, actual mobile Telegram keyboard/screen-reader testing, and live staging integrations remain release checks.
