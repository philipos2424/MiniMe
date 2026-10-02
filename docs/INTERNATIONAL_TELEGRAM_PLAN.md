# MiniMe international Telegram agent: audit and launch plan

Prepared 21 September 2026. Status: proposal, not an implemented integration.

Follow-up implementation status is tracked in [MARKET_RELEASE_CHECKLIST.md](MARKET_RELEASE_CHECKLIST.md). Several billing and webhook findings below now have tested local fixes; this table records the original audit. Polar, Stars subscriptions and international onboarding are not yet implemented.

Working assumption: MiniMe remains an agent for business owners, operated through Telegram. The initial job is managing customer inquiries, drafting replies, following up, and reporting outcomes. The user's product preference and seller registration country are still open.

## What exists

The live application is `apps/web`. It already includes a shared Telegram agent, merchant bots, Telegram Business connections, owner commands, reminders, tools, draft approvals, products, orders, and a Mini App. Build on these capabilities rather than starting another bot implementation. `apps/bot` is deprecated.

The existing `docs/PRODUCT_ARCHITECTURE.md` also describes Telegram as the owner's control surface with other channels feeding a shared business brain. That direction fits this proposal.

## Findings from the current checkout

These are source-level findings, not claims about the currently deployed service. Existing uncommitted changes were present before this review and were left intact.

| Priority | Finding and evidence | Required action |
| --- | --- | --- |
| P0 | `apps/web/src/app/api/payment/subscribe/route.js:100` accepts `x-business-id` without authenticating ownership when Telegram authentication fails or is missing. The manual-payment branch then writes that business's payment reference and method (around line 351). | Remove this fallback. Resolve the business from a verified identity and membership check. Add a regression test proving another business cannot initiate or replace its payment state. |
| P0 | Checkout accepts `durationMonths` and charges for it, but the signed gateway webhook calls `upgradeSubscription` without that duration (`api/payment/webhook/route.js:138`). The helper defaults to one month (`lib/server/billing.js:228`). | Persist an immutable checkout purchase record; validate allowed terms. Grant the purchased period from verified provider state. A twelve-month purchase must receive twelve months. |
| P0 | The gateway webhook has signature checks but no event deduplication before upgrading. `upgradeSubscription` resets expiry from the processing time and logs a new payment. | Make processing transactional and idempotent by provider/event ID and purchase ID. Preserve remaining entitlement on prepaid renewal; use provider period dates for recurring subscriptions. Handle out-of-order events. |
| P1 | Existing Stars handling is for merchant orders, not MiniMe subscriptions (`replyEngine.js:372`). It selects an order by ID alone and repeats stock deduction on each successful-payment delivery. Pre-checkout currently answers `ok: true` unconditionally (line 3539). | Bind invoices to tenant, purchaser, purpose, amount and currency. Reject mismatches, deduplicate charge IDs, and update order/stock atomically. Add a separate SaaS entitlement handler. |
| P1 | Scheduling uses a fixed UTC+3 offset and `time_eat` (`ownerCommands.js:907–937`). | Store an IANA time zone per business; retain UTC instants and calculate recurring local times with DST support. Test Kolkata, New York and Nairobi. |
| P1 | Product creation writes `currency: 'ETB'` (`ownerCommands.js:1470`); subscription display is ETB-centered (`lib/plan.js:133`). | Separate merchant catalog currency, SaaS billing currency, locale and seller payout currency. Store monetary amounts in minor units with currency metadata; do not relabel ETB amounts as USD/INR. |
| P1 | No Polar integration was found in application/shared source. Current subscription checkout offers Stripe, PayPal, Chapa and manual Ethiopian rails. | Add a dedicated Polar adapter and lifecycle handling, rather than renaming an existing payment option. |
| P2 | `replyEngine.js` has 9,429 lines. Telegram webhook routes await tenant processing within a 60-second request. | Extract billing and agent policies first; use durable inbound events and workers for slow model/tool calls. Record retries and delivery outcomes. This is a scale/reliability risk, not a demonstrated live outage. |

Validation: `npm test` passed all 788 tests and `npm run web:build` completed successfully with warnings. The build also logged a static-render bailout for `/api/whatsapp-connect`, which was included as a dynamic route in the successful output. These checks do not demonstrate production webhook health, provider credentials, applied migrations or actual checkout success. Local output is retained in `minime-audit-tests.log` and `minime-audit-build.log` (ignored by Git).

## Payment design

MiniMe's own software subscription and a merchant's customer orders are different money flows. Polar is proposed for MiniMe SaaS sales, not for collecting every merchant's retail revenue.

Telegram requires Stars for digital goods/services sold inside bots and Mini Apps, even when an external website also exists. Therefore implement Stars for in-Telegram upgrades. Use Polar for independently acquired website purchases; do not build an in-bot external checkout redirect as a workaround. Verify the permitted account-linking/access experience before release. [Telegram digital payments](https://core.telegram.org/bots/payments-stars)

Polar's published country coverage includes US and Indian buyers and lists Ethiopia and Kenya for seller payouts. Actual onboarding depends on the seller's verified identity, business type and payout account. Confirm the real seller country rather than inferring it from the target markets. [Supported countries](https://polar.sh/docs/merchant-of-record/supported-countries)

Polar documents multi-currency product pricing including USD and INR. That does not establish UPI availability: no official UPI confirmation was found in this review. Treat Indian recurring-card acceptance and available checkout methods as pilot acceptance tests. [Product currencies](https://polar.sh/docs/features/products)

New Polar organizations currently start at 5% + $0.50 per transaction; non-US cards add 1.5%. Payout and FX costs may also apply. Include model, hosting and support costs before choosing plan limits. [Fees](https://polar.sh/docs/merchant-of-record/fees)

### Integration contract

1. Authenticate the website customer, then link Telegram through a short-lived, single-use challenge bound to that account. A Telegram username or client-supplied business ID is insufficient proof.
2. Create checkout server-side from an allowlisted product/price mapping. Bind the authenticated billing account using Polar's external customer ID. Persist provider checkout ID, tenant, plan, currency, amount and term. [Checkout API](https://polar.sh/docs/features/checkout/session)
3. Validate webhook raw bodies with the official SDK and configured signing secret. Store each verified event durably with a unique provider/event key before acknowledging it. Process asynchronously and retry failures. Polar's signing-secret handling changed in September 2026: use current documentation and a compatible pinned SDK. [Webhook delivery](https://polar.sh/docs/integrate/webhooks/delivery)
4. Maintain one entitlement service fed by Polar, Stars and existing verified legacy purchases. Track provider subscription IDs, current period, cancel-at-period-end, trial, past-due, ended and refunded states. Reconcile against provider state; never grant access from a success-page query string. [Customer state](https://polar.sh/docs/integrate/customer-state)
5. Preserve access through a paid period after cancellation; define failed-payment grace and refund revocation explicitly. Distinguish partial refunds from full cancellations. Keep billing events and merchant-order payments separate.
6. Provide website subscription management and native Telegram payment support/refunds. Detect an existing active subscription before offering another rail, to reduce double billing.

Suggested storage: billing customers; immutable checkout purchases; provider subscriptions; unique webhook events with processing status; entitlement grants; usage records. Keep existing business plan fields as a derived projection until callers migrate.

## Product experience

Promise: "Your business agent in Telegram: handle customer questions, follow up, and tell you what needs attention."

First session: start the agent, choose business type, confirm country/currency/time zone/language, teach it a small catalog or FAQ, and try a sample customer question. Deliver useful output before requiring BotFather setup. Offer a merchant bot or supported business connection when the owner is ready for live customer traffic.

The owner should be able to say:

- "What needs my attention today?"
- "Draft a reply to this customer."
- "Remind me to follow up tomorrow at 9."
- "Change the price of this product."
- "Show me what you did and what failed."

Use chat for routine work and approvals, with the Mini App for long lists, catalog editing and history. Begin with supervised replies. Autonomous sends require an explicit owner policy and must respect available channel permissions. Keep a visible task status and activity history; report delivery failure instead of claiming success.

## Market plan and pricing experiments

These are proposed pilot choices, not validated market demand or published prices. Target owners already comfortable with Telegram; do not assume all US or Indian small businesses want Telegram as their workspace.

| Market | Initial customer hypothesis | Pilot setup |
| --- | --- | --- |
| USA | Small agencies, consultants and Telegram-using online businesses | English, USD, chosen local time zone; test $19/month with a defined usage allowance. Recruit 10 design partners. |
| India | English-speaking small agencies, tutors and online sellers already using Telegram | English first, INR, Asia/Kolkata; test INR 799/month with a smaller allowance. Recruit 10 design partners; measure payment/renewal success before increasing acquisition. |
| UK, Canada, Australia | Same narrow business profile after the first cohorts retain | English; explicitly configured GBP/CAD/AUD prices and local time zones. |
| Ethiopia / Kenya | Existing and adjacent customer relationships | Preserve existing customer terms; local business currencies and language options. Seller payout eligibility and buyer payment methods remain distinct questions. |

Keep one paid product initially with transparent allowances and optional paid expansion later. Existing Free/Pro promises include unlimited usage, so do not silently impose new limits on current subscribers. Version the new international offer, explain its limits, and measure cost per active account before committing to unlimited service.

## Implementation sequence and acceptance criteria

1. **Repair trust and payments.** Fix checkout authorization, purchased duration, event replay handling and Stars order validation. Exit: cross-tenant attempts fail; duplicate events cause exactly one grant/payment/stock change; purchased periods are preserved; existing tests and new behavioral regressions pass.
2. **Internationalize the core.** Add explicit locale, country, currency and IANA time zone. Migrate current customers using their existing assumptions without converting amounts. Exit: correct INR/USD catalog behavior and reminders across US DST and India's half-hour offset.
3. **Deliver the complete Telegram loop.** Teach, draft, approve, send, follow up, report. Exit: a pilot owner completes one useful workflow without developer assistance; retries are safe and failures are visible.
4. **Integrate payments in sandbox.** Polar website checkout and Stars native purchase feed the same entitlement layer. Exit: initial payment, renewal, duplicate/delayed webhook, cancellation, failed renewal, refund, account linking and double-purchase tests pass.
5. **Run the 20-business USA/India pilot.** Invite partners directly through existing relationships; do not spend on broad country campaigns yet. Suggested expansion gates: at least 70% complete a useful first action within 10 minutes, at least 50% remain active in week four, no unresolved cross-tenant or duplicate-charge issues, and positive contribution margin after variable costs. Review checkout failures separately by country.
6. **Expand only after retention.** Add UK/Canada/Australia cohorts, then languages and additional channels based on demonstrated demand. Avoid coupling this launch to the search marketplace, B2B negotiation network or unverified connector availability.

## Still to confirm

- Whether the intended customer is a business owner or a general personal-assistant user. A personal-agent pivot changes tools, onboarding and the market hypothesis substantially.
- Actual seller registration/residency country and Polar account approval.
- Live bot/webhook health, enabled providers, deployment state, migration state and real usage/revenue. This local audit did not inspect production credentials or perform real charges.
- Indian payment-method availability and renewal behavior in the approved Polar account.
- Applicable Telegram experience for linking an independently purchased website account.
