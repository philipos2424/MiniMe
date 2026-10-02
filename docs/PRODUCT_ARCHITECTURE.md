# MiniMe product and architecture direction

## Product boundary

MiniMe is the business owner's operating agent in Telegram. Telegram is the
control plane: the owner teaches the business, approves risky replies, checks
sales and stock, assigns work, and receives alerts there.

Social channels are customer-facing transports. WhatsApp, Instagram, Facebook
Messenger, and TikTok should feed one shared inbox and one business brain. A
customer's channel must change delivery details, not pricing rules, memory,
catalog facts, trust policy, or reporting.

## Current system

- `apps/web` is the live Next.js application and owns the API routes.
- Telegram has the richest path in `replyEngine.js`, including owner commands,
  onboarding, draft approvals, learning, orders, and agent tasks.
- Meta has a shared webhook and channel adapters in `metaEvents.js` and
  `metaReplyEngine.js`. Nango is the preferred OAuth/token path for Instagram
  and Facebook; WhatsApp still has a legacy token path.
- TikTok has an OAuth connection, a shared webhook, token refresh, and a
  channel adapter. Its Business Messaging API is regionally gated and must be
  treated as an optional connector.
- `channelPipeline.js` is the intended shared orchestration layer for non-
  Telegram channels: deduplication, customer/conversation upsert, entitlement,
  AI draft, trust decision, owner notification, and outbound persistence.
- The Mini App already contains the shared inbox, products, customers,
  onboarding, settings, billing, trust levels, and channel settings.
- `apps/bot` is deprecated legacy code. Keep it only until its Railway webhook
  is confirmed unused, then remove it in a separate deletion change.

## CTO priorities

### P0: make the shared inbox trustworthy

1. Keep every inbound event idempotent. The database now enforces uniqueness on
   `(business_id, platform, external_id)`; keep the application pre-check only
   as a fast path.
2. Approve and send drafts through their source channel. Telegram, Meta, and
   TikTok now share the same approval endpoint.
3. Record delivery state and provider message IDs for every outbound adapter.
   A reply is not `sent` merely because the provider request returned; retain
   `queued`, `sent`, `failed`, and retry metadata.
4. Add a channel health view: connected, token valid, webhook receiving,
   last inbound, last outbound, and last error.

### P1: make the agent useful to a merchant

1. Finish one canonical conversation model. Enforce one conversation per
   `(business, customer, platform)` and store provider thread IDs in a common
   channel metadata shape.
2. Make the inbox channel-aware with filters, unread counts, assignee, priority,
   SLA age, and a clear source badge for every message.
3. Add explicit business policies: opening hours, supported languages, refund /
   delivery rules, escalation contacts, and prohibited claims. Policies should
   be checked before an autonomous send.
4. Add outcome tracking: lead, quote, order, paid, delivered, lost. Measure
   conversion by channel and by AI action, not just message count.
5. Add a replayable event log for inbound webhook, normalized message, model
   decision, approval, provider send, and provider result. This is essential for
   support and billing disputes.

### P2: grow without multiplying complexity

1. Put all connectors behind a small adapter contract: `verify`, `normalize`,
   `send`, `refresh`, `health`, and `capabilities`.
2. Move long model calls and outbound sends to a durable queue when volume
   justifies it. Webhooks should acknowledge quickly after durable ingestion.
3. Add templates and campaigns only after consent, quiet hours, opt-out, and
   provider policy enforcement are first-class.
4. Treat TikTok as a capability-limited connector. Do not expose features such
   as cold outreach, attachments, or thread reopening unless the provider
   supports them for that account and market.

## Remove or consolidate

- Do not add more logic to `replyEngine.js`; split transport-independent reply
  policy, context assembly, and learning into focused modules before major new
  features. The file is over 8,500 lines and is the largest architectural risk.
- Replace the unused `messagingGateway.js` with the real channel adapters or
  delete it after import checks. It currently supports only old WhatsApp and
  Telegram helpers and is not the omnichannel path.
- Remove duplicate manual Meta token setup after Nango is proven in production;
  retain an admin-only recovery path during migration.
- Delete `apps/bot` only after checking Railway and each deployed Telegram
  webhook. Use a separate, reviewable change because deletion is irreversible.
- Review feature clusters that are not part of the core loop (B2B network,
  search bot, channel-product ingestion, email) against active usage and
  revenue before expanding them.

## Commercial operating model

Start with one promise: “Never miss a customer message; MiniMe answers routine
questions and brings you the conversations that need you.” The paid boundary
should be measurable: number of connected channels, AI-handled conversations,
automations, and team seats. Keep a free supervised tier, then charge for
additional channels, autonomous sends, history, and agent tasks.

The first success metric is not total AI messages. It is qualified inquiries
resolved, orders created, and owner time saved without an increase in correction
rate or customer complaints.
