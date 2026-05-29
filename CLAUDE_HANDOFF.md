# MiniMe — Full Project Handoff Document

**For:** New Claude session  
**Project path:** `C:\Users\HPZBOOK-G9\minime\apps\web`  
**Live URL:** `https://web-theta-one-68.vercel.app`  
**Supabase project:** `hbmesjhkczhqpbdseifd`  
**Stack:** Next.js 14 App Router · Supabase (Postgres + Storage) · Vercel · OpenAI GPT-4.1 · Telegram Bot API

---

## What MiniMe Is

MiniMe is an AI-powered Telegram Mini App that acts as a **business assistant for Ethiopian SMBs**. Each business owner links their own Telegram bot; the AI (Alfred) handles customer messages, takes orders, processes payments via Chapa (Ethiopian payment processor), and gives the owner full business management from within Telegram.

**Business model:** SaaS — trial then pro subscription (2,500 ETB/month or 25,000/year). Paid via Chapa or manual CBE/Telebirr bank transfer.

**Current customers:** 9 active businesses across food, fashion, creative, and marketing industries. Busiest bots handle 70–130 messages/week. All bots reply within ~9 seconds on average.

---

## Architecture

```
Customer (Telegram) 
    ↓ POST
/api/telegram/webhook/[secret]
    ↓
handleTenantUpdate() [replyEngine.js]
    ↓
  ┌──────────────┬──────────────┬──────────────┐
  │ tryCheckout  │  runBrain    │ draftReply   │
  │ (fast order  │  (agentBrain │  (pipeline   │
  │  checkout)   │   agentic)   │   fallback)  │
  └──────────────┴──────────────┴──────────────┘
    ↓
Telegram sendMessage → Customer
    ↓
owner notified via their bot
```

**Key files:**
| File | Purpose |
|------|---------|
| `src/lib/server/replyEngine.js` | Main bot engine (~3500 lines). Handles all Telegram messages, owner commands, checkout, brain dispatch |
| `src/lib/server/agentBrain.js` | Autonomous tool-calling agent (GPT-4.1). Handles complex orders, jobs, knowledge queries |
| `src/lib/server/metaReplyEngine.js` | WhatsApp/Instagram/Facebook message handler — same AI pipeline as Telegram |
| `src/lib/server/sanitize.js` | Central input validation library (17 validators) |
| `src/lib/server/audit.js` | SOC 2 audit logging helper |
| `src/lib/server/auth.js` | `requireOwner()` guard for sub-admin API protection |
| `src/lib/server/admin.js` | Platform admin allowlist (env-var driven, no hardcoded IDs) |
| `src/lib/server/selfImprove.js` | Weekly cron: reads corrections, auto-adds behavior rules |
| `src/lib/server/categoryTemplates.js` | Per-category AI personality seeds (food/fashion/beauty etc.) |
| `vercel.json` | 9 cron jobs (morning briefing, reminders, auto-learn, birthdays, etc.) |

---

## What's Been Built (complete feature list)

### Core Bot Features
- ✅ Multi-tenant Telegram bot (each business has their own @bot)
- ✅ AI replies in Amharic + English (Hasab translation engine)
- ✅ Brain mode — agentic GPT-4.1 handles orders conversationally (tools: reply, create_order, create_job, send_catalog, notify_owner, etc.)
- ✅ Trust levels: Supervised (draft + notify) / Trusted (auto-send) / Full Agent
- ✅ Typing indicator while Alfred thinks
- ✅ Photo/voice/document analysis (OpenAI Vision + Whisper)
- ✅ Customer-side commands: `/status`, `/catalog`, `/myorders`, `/loyalty`
- ✅ Owner-side commands: `/orders`, `/sales`, `/stock`, `/price`, `/restock`, `/dm`, `/teach`, `/rule`, `/rules`, `/knowledge`, `/forget`, `/search`, `/reminders`, `/discount`, `/advisor`
- ✅ Broadcast STOP/START opt-out (customer types STOP → never receives broadcasts)

### Orders & Payments
- ✅ Chapa payment integration (full end-to-end: order → payment link → callback → mark paid)
- ✅ CBE manual payment (customer sends screenshot, owner confirms via Telegram button)
- ✅ Telebirr manual payment (same flow)
- ✅ Telegram Stars support
- ✅ Order management (pending, paid, fulfilled, cancelled, refunded)
- ✅ Refund workflow (Chapa refund API + customer DM + audit log)
- ✅ Receipt auto-sent on Chapa payment (Markdown + printable `/receipt/[id]` page)
- ✅ Order status push notifications to customers (paid/fulfilled)
- ✅ Free-form orders for businesses without catalog (brain confirms price, creates order)
- ✅ Discount code detection and application at checkout
- ✅ Loyalty points updated automatically on every payment (1 pt per 10 ETB)
- ✅ First-sale celebration (owner DM + dashboard banner)

### Products & Catalog
- ✅ Product CRUD from dashboard
- ✅ CSV import/export
- ✅ Product photos (upload, magic byte validation, MIME allowlist)
- ✅ Bulk AI description generation (GPT-4o-mini)
- ✅ Variant system (bracket suffix: "Dress [S]", "Dress [M]")
- ✅ Category grouping
- ✅ Archive/restore
- ✅ Shareable price list (Telegram Markdown format)
- ✅ `/catalog` command — customer browses inline

### Discount & Promotions
- ✅ Discount codes table in DB (percent or fixed ETB, min order, max uses, expiry)
- ✅ `/discounts` dashboard page (CRUD + share button + toggle)
- ✅ Bot command: `/discount SUMMER20 20%`
- ✅ Active discounts shown in AI system prompt (Alfred mentions them)
- ✅ Discount applied at checkout (amount deducted, receipt shows savings)
- ✅ Broadcast page: one-tap insert promo code into message
- ✅ Discount badge on orders list + detail page

### Customer Management
- ✅ Customer profiles (name, phone, tags, notes, tier, loyalty points)
- ✅ Order history per customer
- ✅ Loyalty tier: Bronze / Silver (100+ pts) / Gold (500+ pts)
- ✅ Customer memory (auto-extracted facts from conversations)
- ✅ Birthday field + auto-detection from chat ("my birthday is...")
- ✅ Birthday wish cron (7am EAT daily) + owner heads-up the day before
- ✅ Broadcast opt-out column (`broadcast_opted_out`)
- ✅ Customer data export API (`/api/customers/[id]/export`)
- ✅ Right-to-be-forgotten endpoint (`/api/customers/[id]/erase`)
- ✅ `/myorders` — customer checks their order history

### Analytics
- ✅ Full analytics page with charts (revenue/day, hour heatmap, top products, busiest day)
- ✅ Period selector: 7d / 30d / 90d / all
- ✅ Velocity alerts (products running out within 7 days)
- ✅ Top customers by spend
- ✅ AI accuracy metrics (edit rate, hours saved)
- ✅ Comparison to previous period

### Broadcasts
- ✅ Send to: Everyone / Buyers only / Never ordered / Inactive 30 days / Gold / Silver / Bronze tiers
- ✅ Rate limited: 1 per 5 minutes
- ✅ Throttled: 50ms per send (respects Telegram limits)
- ✅ Broadcast history stored in `notification_prefs.broadcast_history`
- ✅ Opt-out excluded automatically from all segments

### Staff (Sub-admins)
- ✅ Owner can add staff by @username or Telegram ID
- ✅ Staff can use read-only commands: `/orders`, `/sales`, `/stock`, `/customers`, `/search`, `/reminders`
- ✅ Staff blocked from destructive commands: `/refund`, `/dm`, `/teach`, `/rule`, `/discount`
- ✅ Staff add/remove logged in audit trail
- ✅ Settings → Staff page

### Knowledge & Teaching
- ✅ Document upload (PDF, Word, images — with OCR via Vision API)
- ✅ URL ingestion (SSRF-protected, private IPs blocked)
- ✅ RAG retrieval (text-embedding-3-small)
- ✅ FAQ system (exact Q&A pairs stored in `owner_instructions`)
- ✅ Self-improve cron (weekly — reads corrections, adds behavior rules)
- ✅ Category templates (food/fashion/beauty/electronics/grocery/services/crafts)
- ✅ Voice profile learning (tone, phrases, greeting style)

### Settings & Profile
- ✅ Business profile page with SSRF-protected URL fields
- ✅ Bot link flow (validate token → set webhook → seed commands → notify admin)
- ✅ Fix commands (owner-only scoped, customers see empty list)
- ✅ Notification preferences (morning briefing opt-in, DND hours, quiet mode)
- ✅ Trust & autonomy slider
- ✅ Payments config (Chapa, CBE, Telebirr, Telegram Stars, conversion rates)
- ✅ WhatsApp / Instagram / Facebook connect
- ✅ Billing page (Chapa + manual payment screenshot upload)
- ✅ Digital business card page (share contact info)
- ✅ Bot commands guide page (with new customer commands section)
- ✅ **Audit Log page** (`/settings/audit`) — filterable, expandable event rows

### Conversations UI
- ✅ Conversations list with draft queue, search, filters (All / Drafts / Unread / Resolved)
- ✅ Chat detail view with customer tab, file tab, note editor
- ✅ Draft approval inline (✓ Send / ✗ Skip)
- ✅ **"Send all" bulk approve** button
- ✅ Conversation export (CSV or plain text) — download icon in chat header
- ✅ Typing bubble animation while AI drafts
- ✅ `requires_owner` auto-clears when Alfred successfully replies

### Orders UI
- ✅ Orders list with status filter tabs + **search bar** (name, item, promo code)
- ✅ **Tap-to-DM** (💬 opens customer in Telegram)
- ✅ Quick status change from list
- ✅ Order detail page: items, timeline, delivery status, private note, receipt send, refund
- ✅ Discount badge + savings shown on discounted orders
- ✅ **Manual order creation** from dashboard (walk-in/phone customers)

### Pipeline
- ✅ 5-column Kanban (New → In Progress → Awaiting Pay → Paid → Fulfilled)
- ✅ **Quick-advance buttons** (✅ Mark paid / 📦 Fulfill) on each card — no need to open detail

### Home Dashboard
- ✅ Daily greeting with contextual message
- ✅ Draft queue with inline Approve / Skip
- ✅ "Send all" bulk approve
- ✅ Revenue card, stock alerts, profile completeness
- ✅ **First-sale celebration banner** (one-time confetti)
- ✅ Agent thoughts visible (brain reasoning)

### Cron Jobs (9 active)
| Cron | Schedule | Purpose |
|------|----------|---------|
| `morning-briefing` | 5am UTC daily | Owner DM with overnight stats (opt-in) |
| `reminders` | 7am UTC daily | Payment reminders, feedback requests, re-engagement |
| `birthdays` | 4am UTC daily | Customer birthday wishes + owner heads-up |
| `followups` | 6am UTC daily | Follow up on pending conversations |
| `auto-learn` | 3am UTC daily | Embed new knowledge from recent corrections |
| `self-improve` | 4am UTC Mondays | Analyze corrections → add behavior rules |
| `weekly-digest` | 5am UTC Mondays | Business summary DM to all owners |
| `llm-stats` | 6am UTC daily | Track API cost per business |
| `healthcheck` | 9am UTC daily | Bot webhook status check |

### Meta Channels (WhatsApp / Instagram / Facebook)
- ✅ Inbound messages fully handled (signature verification, dedup, AI replies)
- ✅ Outbound replies from dashboard now fixed (`platform` column properly selected)
- ✅ Same AI pipeline as Telegram (draftReply, brain, RAG)

### Admin Panel (`/admin`)
- ✅ Business overview (metrics, revenue, messages, bots)
- ✅ Webhook health checker (live getWebhookInfo per bot)
- ✅ API cost tracking per business
- ✅ Platform advisor (grounded AI, no hallucinations)

---

## Security & Compliance (recently completed)

### Access Control
- ✅ Timing-safe Telegram webhook secret comparison (`crypto.timingSafeEqual`)
- ✅ 24-hour initData expiry enforcement (replay attack prevention)
- ✅ Sub-admin REST API gates — staff cannot call destructive endpoints from dashboard
- ✅ `requireOwner()` helper used on: refund, staff CRUD, discount CRUD, message approve
- ✅ Admin allowlist — **no hardcoded IDs**, purely `ADMIN_TELEGRAM_IDS` env var with 60s cache

### Input Sanitization (17-validator library at `src/lib/server/sanitize.js`)
- ✅ All API routes sanitized: str, name, url, num, price, stock, oneOf, isoDate, arr, imageFile
- ✅ SSRF prevention on all URL fields (blocks 127.x, 10.x, 192.168.x, private ranges)
- ✅ File uploads: MIME allowlist + extension allowlist + **magic byte verification** + 5MB cap
- ✅ Telegram file.url restricted to `*.telegram.org` only
- ✅ **Prompt injection prevention**: 20+ jailbreak patterns stripped from every customer message before AI
- ✅ Chat history capped: 500 chars/message, 5000 total before AI injection
- ✅ agentBrain tool arguments sanitized (create_order address/phone/notes, create_job fields)

### Audit Logging
- ✅ `audit_logs` table in Supabase (SOC 2 CC6.1, CC6.3, CC7.2)
- ✅ `audit.js` helper with `audit()`, `ownerAudit()`, `systemAudit()`
- ✅ Events logged: refunds, staff changes, discounts, broadcasts, order status, bot token, subscription, auth failures, opt-out/in
- ✅ `/api/audit` read endpoint (owner-scoped, IPs partially redacted)
- ✅ Settings → Audit Log viewer page

### Concurrency Safety
- ✅ Unique DB indexes: `customers(business_id, telegram_id)`, `conversations(business_id, customer_id)`
- ✅ `webhook_dedupe` table — Telegram retry storms now ignored (23505 conflict = already processed)
- ✅ N+1 query in `/api/home/feed` fixed (batched query)

### Data & Privacy
- ✅ `broadcast_opted_out` column — STOP/START in any language
- ✅ `customers.birthday` column
- ✅ `orders.refunded_at`, `orders.refund_reason` columns
- ✅ `discounts` table
- ✅ Customer data export endpoint
- ✅ Right-to-be-forgotten endpoint (anonymizes PII, preserves order history)
- ✅ CRON_SECRET URL-param fallback removed — header-only auth

---

## What's Still To Do (planned, not yet built)

### High Priority
1. **Upstash Redis for rate limiting** — in-memory Maps reset on cold start; need persistent rate limit so broadcast throttle and IP limits survive restarts. Dep: `@upstash/ratelimit` + `@upstash/redis`. File: `src/lib/server/rateLimit.js`

2. **RLS policies** — all tables rely on service-role key bypass. Adding `CREATE POLICY` to every table gives defense-in-depth if the app-layer ever fails. File: SQL migration.

3. **PII encryption at rest** — customer phone numbers and names are plaintext in DB. Add `encryptShort()`/`decryptShort()` to crypto.js and backfill. Currently relies only on Supabase TLS in transit.

4. **Admin "impersonate business"** — no way to debug a client's bot without their credentials. Plan: JWT with `IMPERSONATE_SECRET`, 30-min expiry, visual banner, full audit trail. File: `src/app/api/admin/impersonate/route.js`

5. **Sentry integration** — all errors go to `console.error` (Vercel ~24h retention). Need `@sentry/nextjs` with `business.id` tag and PII scrubbing rules.

### Medium Priority
6. **k6 stress tests** — scripts exist at `tests/stress/` but need to actually run and document results. Includes: concurrent-order race, dashboard burst, broadcast storm, auth timing ratio tests.

7. **SOC 2 vendor questionnaire docs** — planned but not written:
   - `docs/SECURITY.md`
   - `docs/PRIVACY.md`  
   - `docs/DPA.md` (Data Processing Agreement template)
   - `docs/INCIDENT_RESPONSE.md`
   - `docs/SUB_PROCESSORS.md` (Supabase, Vercel, OpenAI, Chapa, Hasab)
   - `docs/VENDOR_QUESTIONNAIRE.md` (pre-filled enterprise procurement answers)
   - `docs/SOC2_GAP_ANALYSIS.md` (honest readiness assessment)

8. **Full business export** — owners can export individual conversations but not everything (products, all customers, all orders, settings) as a ZIP.

9. **Data retention cron** — messages live forever. Need weekly cron to archive messages >18 months to Storage JSONL.

10. **Plan downgrade UI** — no self-serve way to cancel or downgrade mid-cycle.

### Lower Priority
11. Email/Gmail integration — waitlist page only, no backend
12. Auto-renewal subscriptions (Chapa doesn't support recurring)
13. Multi-currency (only ETB currently)
14. Penetration test by external firm (schedule after stress tests pass)

---

## Environment Variables (Vercel Production)

| Var | Purpose |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | Platform bot (MiniMeAgentBot) |
| `SUPABASE_SERVICE_ROLE_KEY` | Full DB access (bypasses RLS) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase REST endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side Supabase |
| `OPENAI_API_KEY` | GPT-4.1, GPT-4o-mini, text-embedding-3-small |
| `ENCRYPTION_KEY` | AES-GCM key for bot token encryption |
| `CRON_SECRET` | Bearer token for all cron endpoints (header-only) |
| `WEB_URL` | `https://web-theta-one-68.vercel.app` |
| `CHAPA_SECRET_KEY` | Chapa payment API |
| `ADMIN_TELEGRAM_IDS` | Comma-separated platform admin Telegram IDs |
| `PLATFORM_ADMIN_TELEGRAM_ID` | Single admin for Telegram notifications |
| `HASAB_API_KEY` | Amharic translation/polishing API |

---

## Known Issues / Watch Points

1. **Vercel lockfile warning** — `"Failed to patch lockfile"` appears on every build. Harmless — doesn't affect compilation or runtime. Fix: `cd apps/web && npm install` when you have time.

2. **agentBrain 37s responses** — brain runs MAX_ITERS=4 iterations; complex multi-step orders (steak + drinks + delivery) can take 30-37s. Has last-chance fallback reply if it hits the limit.

3. **Supabase Management API** — requires personal access token (PAT), not service role key. Cannot run DDL programmatically without a PAT. Always run migrations in the Supabase SQL editor.

4. **Fefey restaurant has no products** — uses 12 docs (menu) instead. Brain now supports free-form orders when no catalog exists (unit_price passed explicitly).

5. **Meta outbound replies** — was broken (`platform` column not selected in conversations query). Fixed in current version.

---

## DB Schema — Key Tables

```
businesses         — one row per business, owns everything
customers          — one per customer per business, telegram_id + phone + loyalty + birthday + broadcast_opted_out
conversations      — one per customer-business pair (with requires_owner, last_ai_action)
messages           — every message in/out with is_ai_generated, confidence, owner_edited
orders             — with items (JSONB), status, chapa_tx_ref, meta (discount_code, receipt_sent_at)
products           — catalog items with stock, image_url, variants
documents          — knowledge base files + chunks (embeddings in document_chunks)
jobs               — multi-step agent jobs (pipeline with steps array)
discounts          — promo codes with type/value/min_order/max_uses/expires_at
audit_logs         — SOC 2 event trail (actor, action, resource, metadata, ip)
webhook_dedupe     — (business_id, update_id) PK — prevents Telegram retry duplicates
agent_thoughts     — agentBrain reasoning traces (tool_calls, outcome, duration_ms)
feedback           — customer 5-star ratings + helpful boolean
reminders          — scheduled Telegram alerts for owners
llm_call_log       — cost tracking per call (model, tokens, cost_usd)
```

---

## Quick Start for New Claude

To continue working on this project:

1. **Read key files first:**
   - `src/lib/server/replyEngine.js` — understand the main bot flow
   - `src/lib/server/agentBrain.js` — understand the agentic brain
   - `src/lib/server/sanitize.js` — understand the validation library (use it on every new route)
   - `src/lib/server/audit.js` — use `audit()` on every destructive action

2. **Pattern for every new API route:**
   ```js
   import { str, oneOf, ValidationError, validationResponse } from '../../../../lib/server/sanitize';
   import { audit } from '../../../../lib/server/audit';
   import { requireOwner } from '../../../../lib/server/auth';
   
   // Validate inputs
   try { field = str(body.field, { field: 'field', max: 200, required: true }); }
   catch (e) { return validationResponse(e); }
   
   // Guard owner-only actions
   if (!requireOwner(business, tgUser)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
   
   // ... do the work ...
   
   // Log audit trail
   await audit({ business_id: business.id, actor_type: 'owner', actor_id: String(tgUser.id), action: 'thing.done', resource_type: 'thing', resource_id: id, metadata: { key: 'value' }, request });
   ```

3. **Deploy:** `cd apps/web && npx vercel deploy --prod`

4. **DB migrations:** Run in https://supabase.com/dashboard/project/hbmesjhkczhqpbdseifd/sql

5. **Check bots are healthy:**
   ```js
   // In Supabase dashboard, run:
   SELECT business_id, COUNT(*) as thoughts_1h FROM agent_thoughts WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY 1;
   ```
