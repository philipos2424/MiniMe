# MiniMe market release checklist

Status: launch preparation in progress; not launched. Updated 21 September 2026.

## The offer

MiniMe is a business assistant operated from Telegram: teach it your business, review customer reply drafts, approve delivery and track follow-ups. Start with English-speaking business owners already using Telegram in the USA and India. Treat this segment as a hypothesis, not proven demand.

Keep the pilot focused on one complete customer workflow. Marketplace discovery, B2B negotiations, broad autonomous outreach and every social connector are not prerequisites for this offer.

## Implemented locally

- Billing overview and checkout require verified Telegram identity and business ownership. A supplied business ID cannot select another tenant.
- Checkout validates its plan, method and term before provider work. Annual manual checkout is refused until that path can preserve its term. PayPal is unavailable until capture and verified fulfillment exist.
- Stripe/Chapa checkouts persist their authoritative price and term before creating payment sessions.
- Automated payment methods are not offered unless their webhook signing secret is configured, preventing checkout when paid activation cannot be verified.
- Migration 056 adds atomic subscription fulfillment. It validates provider/reference/amount/currency, locks purchases and businesses, preserves remaining paid access, records the payment and marks the purchase fulfilled together. Replays do not extend access or add ledger entries.
- Chapa confirmations are checked against its verification API, including live/test mode, before granting access. Payout/refund events cannot grant subscriptions.
- The main Telegram webhook rejects requests when its signing secret is absent or wrong. Setup and automatic webhook repair also require the secret.
- The VPS script installs build dependencies and starts a missing PM2 process on rerun after first-time environment setup.

These changes are not deployed. Migration 056 has not been applied to production. Pre-existing work in the checkout was preserved.

Validation: the full suite currently passes 813 tests, including real PostgreSQL execution through PGlite for annual terms, replay handling, mismatched payment evidence, rollback after ledger failure and restricted function access. Route tests exercise billing ownership and signed payment webhook behavior. Production build passes on restored Next.js 14.2.35 with existing Sentry/unpdf bundling warnings and the WhatsApp static-render bailout. `git diff --check` passes. The VPS script was reviewed but not executed on this Windows machine. Test/build success does not clear the dependency or live-payment release gates below.

## Production evidence

- Supabase identifies MiniMe as active/healthy. This is infrastructure status, not an end-to-end product test.
- A read-only database check confirmed that the existing payment-method constraint excludes Stripe and PayPal. Migration 056 corrects that mismatch.
- Vercel CLI authentication works. Its production environment listing includes AGENT_BOT_WEBHOOK_SECRET but does not list POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET. Configuration values were not printed or changed intentionally; presence does not prove validity.
- The Vercel connector is disconnected; CLI access is available.
- Browser OTP login exists, but the application and billing currently depend on Telegram initData. An independent website purchase/account-linking flow is still required.

## Release gates, in order

1. **Supported runtime and dependency review.** Resolve applicable production vulnerabilities and verify the dependency changes separately. The initial production dependency audit reports 31 affected packages (3 critical, 9 high, 15 moderate, 4 low), including legacy workspace dependencies. This count is not evidence that every advisory is exploitable in the deployed web app. An isolated Next.js 15.5.24 installation was attempted after reviewing the official upgrade/security notes, but failed with a network ECONNRESET. The existing version remains the intended restored baseline; the upgrade is not complete. Do not run a blind force upgrade.
2. **Database and security release.** Run tests/build, apply migration 056 before code using it, verify the configured Telegram secret matches registration, then deploy and smoke-test. Reconcile any old in-flight Stripe/Chapa sessions that have no purchase record; they now require manual reconciliation instead of trusting metadata.
3. **Independent web account and Polar.** Confirm actual seller country/account approval; implement verified website identity and Telegram linking, server-side Polar checkout, signed webhooks, subscription renewal/cancellation/refund handling and reconciliation. The existing Stripe/Chapa purchase table is not a complete Polar recurring-billing implementation.
4. **Native Telegram purchase.** Implement MiniMe subscription purchases through Stars and payment support/refunds. The existing Stars merchant-order code is not this feature. Do not direct an in-Telegram software upgrade to an external payment provider as a workaround.
5. **International behavior.** Persist country, business currency, locale and IANA time zone. Remove fixed EAT assumptions from reminders and prompts. Verify New York daylight-saving transitions and Kolkata's half-hour offset. Keep SaaS billing currency separate from merchant product prices.
6. **Reliable agent execution.** Durably record work before acknowledging webhook receipt; add replay-safe processing and visible task failures. Current catch-and-return-200 behavior can lose failed work. Test the full teach → draft → approve → deliver → follow-up loop.
7. **Pilot and support.** Recruit 10 US and 10 Indian businesses, monitor first useful action, week-four retention, wrong replies, failed tasks, checkout failures and contribution margin. Validate Indian checkout and renewal behavior; do not promise UPI without confirmation.

## Pilot package

Pricing experiments, not published prices: US USD 19/month and India INR 799/month with explicit, costed usage allowances. Existing subscribers keep their existing terms. Decide limits from measured model and support costs before taking payment.

Onboarding acceptance: a new owner can teach five FAQs or products, obtain a useful draft, approve one reply, and see its delivery status without developer help. Aim for a first useful action in ten minutes.

Interview script for each pilot owner:

1. Walk through the last customer message you missed or answered late.
2. Show how you currently manage replies and follow-ups.
3. Try MiniMe with a real example; observe where you hesitate or need help.
4. Which action would you trust it to perform automatically, and which requires approval?
5. What measurable result would make you pay for it next month?

Record actual behavior and exact feedback with consent. Keep US and India findings separate; do not invent testimonials or customer personas from assumptions.

Draft invitation for the founder to send to relevant contacts (not sent automatically):

> I’m testing MiniMe, a business assistant you operate from Telegram. It learns your FAQs and products, drafts customer replies for your approval, and helps track follow-ups. I’m looking for a small group of business owners to try it on real work and tell me where it falls short. Would you be open to a short setup session?

Do not spend on broad ads until activation, retention and payment completion are demonstrated. Suggested expansion gates: 70% reach a useful first action, 50% remain active at week four, no unresolved tenant isolation/payment duplication defects, and positive contribution margin. These are proposed operating targets, not forecasts.

## Inputs needed from the owner

- Actual seller registration/residency country and whether Polar has approved the account.
- Securely configure Polar credentials/product IDs in the deployment environment when the integration is ready; never paste API secrets into chat.
- Confirm the first cohort is business owners using Telegram. A general personal-assistant pivot requires a different onboarding and tool set.

## Sources

- [Telegram digital payments](https://core.telegram.org/bots/payments-stars)
- [Polar supported countries](https://polar.sh/docs/merchant-of-record/supported-countries)
- [Polar product currencies](https://polar.sh/docs/features/products)
- [Polar webhook handling](https://polar.sh/docs/integrate/webhooks/delivery)
- [Chapa webhook and transaction verification requirements](https://developer.chapa.co/integrations/webhooks)
- [Next.js August security release](https://nextjs.org/blog/august-2026-security-release)
