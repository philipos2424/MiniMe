# MiniMe: usage evidence and product decisions

Measured on 22 September 2026, approximately 02:49 EAT / 21 September 23:49 UTC. Source: read-only aggregate SQL against the connected MiniMe Supabase project. Rolling windows use database UTC time. No customer message bodies, names, contact details, credentials, or individual identities were exported.

## Decision

Prioritize getting a new owner to a useful, successfully delivered reply, then getting them back the following week. A visual refresh supports this, but cannot repair failed delivery, slow responses, or an unmeasured payment journey.

## What the live data says

| Measure | Observation | Interpretation / limit |
| --- | --- | --- |
| Registered businesses | 999 total; 74 created in 30 days | Registrations are not active customers or paying customers. |
| Onboarding flag | 470 marked complete | Historical state, not an ordered conversion funnel. |
| UI activity, 30 days | 6,540 events; 514 sessions; 156 distinct attributed businesses | Includes multiple surfaces and unverified client attribution. Not authenticated owner MAU. |
| Unattributed UI events | 757 / 6,540 (11.6%) | Some are public visitors; attribution gaps also exist. |
| Messaging activity | 1,710 messages across 60 businesses in 30 days; 26 businesses in 7 days | Includes customer, owner and system traffic; not a count of owners returning. |
| AI outbound records, 30 days | 451 sent; 60 failed | 11.7% of these 511 records are marked failed. This is not a deduplicated delivery-attempt failure rate or proof of customer receipt. |
| Agent run duration, 30 days | 177 runs; median 35.2 seconds; p95 74.5 seconds | Internal run durations, not end-to-end latency for every customer reply. |
| Week-two observed return | 27 / 213 eligible businesses (12.7%) | Any UX event on days 7–13 after first observed event. At least 14 days of observation required. Not signup-cohort or meaningful-outcome retention. |
| Verified payment flag | 1 business | Requires reconciliation with payment provider evidence. |
| Subscription status | 630 businesses marked active | Must not be treated as 630 paying customers. |
| Payments ledger | No rows | Revenue cannot be confirmed from this table. |
| Orders, all time | 16: 9 pending, 4 cancelled, 2 paid, 1 fulfilled | Paid/fulfilled order value totals 28,000 ETB. Merchant order value is not MiniMe subscription revenue. |
| Reply feedback | 34 total, 23 helpful; 9 responses in 30 days | Small, self-selected sample; not evidence of platform-wide answer accuracy. |
| Platform feedback | 13 total; 1 bug response in 30 days, no NPS score | Insufficient for satisfaction or NPS conclusions. |
| AI usage ledger, 30 days | 308 rows; 782,327 tokens; cost_estimate sum 1.038672 | Partial estimated cost coverage. Do not interpret as complete provider spend or gross margin. |
| Geography | All 999 business currency settings are ETB; no country/timezone columns | Cannot infer country, demand in the USA/India, or willingness to pay from currency. |

UX events begin 8 August 2026. Onboarding events begin 1 June 2026. Different start dates, replayable onboarding, admin exclusions, and retention policies limit historical comparisons. Development preview requests may have added a few anonymous events during this session before local tracking was disabled; the attributed-business counts do not depend on them. No records were deleted or rewritten.

## Where people drop out

Within the same rolling 30-day window, matching people and requiring chronological order:

- 132 distinct people reached `welcome`.
- 45 subsequently reached `connected_shared`: 34.1% of those welcome visitors.
- 17 subsequently reached `shared_share_tapped`: 37.8% of those connected, 12.9% of welcome visitors.

These are observed windowed paths, not a completed new-signup cohort. A welcome near the end of the window has had less time to finish. Prior welcome events outside the window are excluded. A sharing tap does not prove a link was sent, a customer arrived, or a reply helped them.

Additional event counts: 69 people started the customer-chat step, 36 reached its reply event, 30 finished it, and 24 skipped it. These step counts are not mutually exclusive and are not all constrained to an ordered path. Review this step with real owners before making it longer or mandatory.

## What people actually use

Distinct attributed businesses with any recorded event on each route, last 30 days; these are not task-completion counts.

| Route | Businesses |
| --- | ---: |
| Home | 128 |
| Onboarding | 110 |
| Chats | 38 |
| Settings | 38 |
| Progress | 32 |
| Products | 28 |
| Profile settings | 26 |
| Advisor | 25 |
| Teach | 18 |
| Conversation detail | 11 |
| Analytics | 11 |
| Customers | 8 |
| Sales pipeline | 8 |
| Billing | 8 |
| Broadcast | 7 |

Eleven businesses generated the explicit `agent.ask.send` intent. Five generated `billing.upgrade.confirm`; that is an interface action, not a verified payment. Only two generated `agent.reply.reject`. There are zero `approved_at` timestamps and zero AI owner-edited flags in the last-30-day messages, so approval/edit-rate reporting needs instrumentation validation before use.

Keep Home, Chats, MiniMe, Progress and Settings consistent across mobile and desktop. Keep Products and Knowledge easy to reach from Home. Do not remove a low-usage capability purely from this table: poor discoverability and missing tracking can also cause low counts.

## Activity trend

Complete calendar weeks, UTC; includes all message directions and types:

| Week beginning | Messages | Businesses |
| --- | ---: | ---: |
| 24 August | 612 | 32 |
| 31 August | 519 | 30 |
| 7 September | 335 | 30 |
| 14 September | 190 | 27 |

Recorded message volume fell 69% from 24 August to 14 September while the number of messaging businesses fell 16%. This suggests reduced depth of usage, but does not establish why. Investigate access expiry, failed replies, traffic acquisition, and logging changes. Do not attribute the change to the UI without evidence. Exclude the incomplete current week from comparisons.

## Measurement defects found in code

1. `api/track` accepts client-supplied identities on anonymous requests. Stored events have no verification flag. Authenticated and unverified attribution cannot be separated retroactively.
2. The client batches events but has no delivery acknowledgement/retry ledger; unload uses unsigned beacon requests. Sessions and sequence numbers exist, but need a server-side deduplication contract before reliable retries.
3. `api/admin/ux` uses the maximum daily distinct count as its multi-day unique-business count. That is only a lower bound. Its repeated averaging of daily medians is not a window-wide median. Use raw-event aggregation or a correct database function.
4. `api/admin/economics` can fall back from verified payment flags to expiry/status as its paying-customer basis. It also assumes one ETB monthly price. That cannot support audited international MRR.
5. `api/home/feed` uses UTC+3 for every business and assumes one revenue currency. Its time-saved figure assumes two minutes per AI reply. These are assumptions, not measured user outcomes.
6. Message approval/edit fields are unused in this observed period; internal agent-run tokens are null despite usage records elsewhere. Coverage must be mapped across every reply path.
7. No UI `error` events were present in the 30-day sample. This does not mean no errors occurred.
8. The home-feed query requests `file_url`, `file_type`, and `file_name`, which were absent from the inspected live messages schema. Query failures can become empty data. Corrected locally to the existing media_url / telegram_file_type / telegram_file_name fields; not deployed yet.

## Measurement plan

North-star candidate: **weekly businesses with at least one customer-facing task successfully completed by MiniMe**. Start with a successfully sent, customer-directed reply; exclude owner tests, internal/system chatter, staff and demo accounts. Add human-reviewed usefulness separately. Do not call a generated draft a completion.

| Decision | Event / evidence | Definition and required properties |
| --- | --- | --- |
| Does setup create value? | Server: `onboarding_completed`, `first_customer_inbound`, `first_reply_sent` | Per business; ordered timestamps; actor role; shared/custom/business channel; onboarding version. Report completion within 24h and 7d among eligible cohorts. |
| Are replies reliable? | Server: `reply_attempted`, `reply_sent`, `reply_failed` | Stable reply/action ID, attempt ID, channel, safe failure category, model, latency. Deduplicate retries; separate generation, transport acceptance and receipt where available. |
| Are replies useful? | Server: `draft_approved`, `draft_edited`, `draft_rejected`; explicit helpfulness | Link to reply ID without copying text. Track approval-to-send success and correction reasons. Human review a consented sample. |
| Is the agent fast enough? | Request receipt, first acknowledgement, completion timestamps | p50/p95 end-to-end by channel and workflow; segment long tools from short answers. Report sample size and missing-timestamp coverage. |
| Does the new home help? | Client `home.ask.open`, `home.priority.*`, `home.workspace.*`; server completion events | Assign a UI version. Compare time to first useful action and task completion, not raw clicks. Observe at least a full weekly cycle and report uncertainty. |
| Do owners return? | Verified owner activity + meaningful task completion | Signup/activation cohorts. Week 1 and week 4 return, excluding ineligible recent cohorts. Separate owner visits from autonomous customer traffic. |
| Will people pay? | Server checkout created, verified payment, entitlement granted, renewal, refund, cancellation | Purchase ID + provider event ID + amount/currency + billing period. Reconcile with provider exports. Never derive MRR from upgrade clicks or default status. |
| Can we serve USA/India? | Explicit country, IANA timezone, locale, selected billing currency | Business-provided preferences, not guesses from Telegram identity, IP or currency. Track checkout success and retention by country only when sample sizes are meaningful. |
| Is each customer profitable? | Per-request token/tool costs + provider invoice reconciliation | Business ID, workflow, model/version, input/output tokens, retries, actual/estimated cost and currency. Separate gross receipts, refunds, taxes, fees and hosting. |
| What blocks use? | Error code, task abandoned, optional contextual feedback | Screen/workflow/version, elapsed time, safe category. No message bodies, names, phone numbers, payment credentials or free-text search terms in analytics. |

Shared event envelope: event_id, server_received_at, occurred_at, pseudonymous business/user IDs where authorized, verified actor role, session_id where relevant, environment, app/UI version, workflow/action ID, source/channel, and allowlisted properties. Keep raw behavioral events short-lived; retain aggregate cohorts as appropriate. Make authentication/identity quality explicit rather than silently mixing anonymous and verified activity.

Keep the existing dotted client intent vocabulary; use explicit server outcome events for successful actions. Client taps are diagnostic, never authoritative business outcomes. Do not add a third-party analytics SDK just to duplicate the existing pipeline.

## What to build next, in order

1. **Reliability and truth:** reconcile failed replies and missing schema fields; add safe failure categories; validate every reply path writes status/timing/cost consistently. Fix aggregate definitions and payment evidence before investor/revenue reporting.
2. **Activation:** test the welcome → business facts → useful sample → connection → first real customer sequence with five new owners. Measure time and completion; capture one short reason when people leave or skip.
3. **Daily workspace:** ship the reviewed home redesign to a small pilot with versioned measurement. Keep urgent work and Teach visible. Evaluate whether more owners complete a useful action and return.
4. **Paid pilot:** reconcile one end-to-end purchase, cancellation and refund per supported rail in its test environment, then real authorized pilot purchases. Paid users are counted only after verified payment.
5. **International expansion:** collect explicit market preferences and recruit separate USA/India cohorts. Current data does not validate either market. Compare activation, task success, week-four retention, paid conversion and contribution margin before expanding acquisition.

Suggested pilot gates are targets to agree and test, not industry benchmarks: every seeded onboarding and payment scenario passes; no unresolved cross-tenant issue; at least 95% of eligible customer reply attempts reach a confirmed send state; first acknowledgement is promptly visible; and all revenue claims reconcile to provider evidence. Real failure categories and latency baselines should inform stricter production targets.

## Changes completed locally in this task

- Corrected home metrics to count only sent AI replies and retain fulfilled orders in paid revenue; query failures now return an error instead of zero activity. Added a regression test.
- New responsive home overview, prioritized actions, empty/loading/error states, retry, accurate currency formatting, clear recorded-day timezone caption, and real activity instead of invented insight.
- Reduced desktop navigation, larger mobile labels, `aria-current`, named navigation, safer storage access, and updated first-run guidance.
- Stable intent labels on the new home actions; client event collection disabled in development so local UI checks do not pollute production telemetry.
- Development-only fixture preview at `/design-preview`; production returns not found. Uses sample data and the actual home component; it does not bypass Telegram authentication.

These changes are local. The database audit used read-only aggregate queries. No deployment, production migration, analytics backfill, external outreach, or revenue claim was made. Browser validation covered the home component with sample data, including mobile overflow and loading/error/retry/paused states; a real Telegram session remains to be tested.
