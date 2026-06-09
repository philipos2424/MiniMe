# MiniMe Security Overview

**Last updated:** 2026-05-16  
**Version:** 3.0

---

## 1. Authentication

| Mechanism | Detail |
|---|---|
| **Telegram Mini App** | HMAC-SHA256 over the `initData` string using the bot token as the HMAC key. Matches Telegram's official specification. `auth_date` is validated to reject tokens older than 24 hours. |
| **Admin panel** | Same initData verification; allowlist checked against `platform_admins` table (no hardcoded IDs). |
| **API-to-API (cron)** | `Authorization: Bearer <CRON_SECRET>` header only. URL-parameter fallback removed. |
| **Telegram webhook** | `x-telegram-bot-api-secret-token` header verified with `crypto.timingSafeEqual` (constant-time, prevents timing attacks). |
| **Meta webhooks** | HMAC-SHA256 signature over the raw body (`X-Hub-Signature-256`), constant-time comparison. |

---

## 2. Authorization / Multi-tenancy

- Every database query is scoped with `.eq('business_id', business.id)`.
- Sub-admins (staff) are read-only via the Telegram bot: `/orders`, `/sales`, `/stock`, `/customers`, `/search`, `/reminders` only.
- Sub-admins are blocked from all destructive REST API endpoints: refunds, discount management, staff management, draft approval.
- Row Level Security (RLS) is enabled on every table as a second defense layer, even though the service-role key bypasses it.

---

## 3. Encryption

| Data | Protection |
|---|---|
| Telegram bot tokens | AES-256-GCM, random 12-byte IV per encryption, auth tag verified on decryption. Format: `gcm1:<iv_b64>:<tag_b64>:<ciphertext_b64>`. Key stored in Vercel env vars, not in code. |
| All data in transit | TLS 1.2+ enforced by Vercel and Supabase. |
| Customer PII (Phase 3) | Phone numbers and names will be encrypted at the application layer using AES-256-GCM before storage. Planned Q3 2026. |

---

## 4. Infrastructure

| Component | Provider | Tier |
|---|---|---|
| Hosting | Vercel | Pro |
| Database | Supabase | Pro (dedicated compute, daily backups, PITR) |
| AI models | OpenAI | Standard (non-training tier) |
| Error tracking | Sentry | Planned |
| Secrets | Vercel Environment Variables | Encrypted at rest |

---

## 5. Audit Logging

All destructive and privileged operations are recorded in an immutable `audit_logs` table:
- Refunds issued
- Staff members added/removed
- Discounts created/deleted
- Broadcasts sent (with segment and recipient count)
- Bot token linked/updated
- Admin impersonation sessions started/ended
- Failed authentication attempts (with IP)

Logs are retained for a minimum of 2 years. Records older than 2 years are archived to cold storage (Supabase Storage, JSONL format).

---

## 6. Rate Limiting

| Endpoint | Limit |
|---|---|
| Telegram webhook | 120 req/min per IP |
| Meta webhook | 100 req/min per IP |
| Broadcast | 1 broadcast per 5 minutes per business |
| Destructive API (refund, staff, discount) | 60 writes/min per business |

---

## 7. Webhook Idempotency

Telegram retries failed webhooks for up to 24 hours. MiniMe deduplicates by `update_id` using a `webhook_dedupe` table, preventing double-replies, double-orders, and double-charges.

---

## 8. Vulnerability Disclosure

To report a security vulnerability: **security@minime.bot**

We commit to acknowledging within 48 hours and providing a fix timeline within 7 business days.

---

## 9. Compliance Roadmap

| Framework | Status |
|---|---|
| GDPR | Partially compliant. Customer data export and erasure workflows in development (Q3 2026). |
| SOC 2 Type I | In preparation. Target: Q4 2026. |
| SOC 2 Type II | Target: Q2 2027. |
| ISO 27001 | Future consideration. |
