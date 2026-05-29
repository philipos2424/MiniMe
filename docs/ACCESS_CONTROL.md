# Access Control Policy

**Effective:** May 2026 | **Owner:** Engineering Lead

---

## 1. Roles & Permissions

| Role | Access | How granted |
|------|--------|------------|
| **Business Owner** | Full control of their business (read + write all own data) | Telegram OAuth via initData |
| **Staff (Sub-admin)** | Read-only bot commands: /orders /sales /stock /customers /search /reminders | Owner adds via Settings → Staff |
| **Platform Admin** | Cross-business analytics + support tooling | `ADMIN_TELEGRAM_IDS` env var (requires PR + approval) |
| **System/Cron** | Scheduled operations (briefings, reminders) | `CRON_SECRET` header (rotated quarterly) |

## 2. Authentication Requirements

- **Business owners:** Telegram initData — cryptographic HMAC-SHA256 signature, max 24 hours old
- **Platform admins:** Same Telegram initData + must be in `ADMIN_TELEGRAM_IDS` allow-list
- **API services (cron):** Bearer token from `CRON_SECRET` env var, header-only (no URL params)

## 3. Principle of Least Privilege

- Owners cannot access other businesses' data (enforced at API layer via `business_id` scope)
- Sub-admins cannot issue refunds, modify settings, or delete data
- Platform admins can view all businesses but cannot modify customer PII without a business owner's request
- No role has access to raw encryption keys — only to decrypted values via application layer

## 4. Privileged Access (Admin Impersonation)

When a platform admin needs to debug a client's dashboard:
1. Admin requests an impersonation token via `/api/admin/impersonate` (max 120 minutes)
2. A JWT is issued signed with `IMPERSONATE_SECRET`
3. All API calls made during the session are tagged with `actor_type: 'platform_admin'` in audit_logs
4. A visible warning banner appears in the dashboard: "🎭 Admin impersonation active"
5. Session is automatically revoked at expiry; admin can also revoke explicitly

## 5. Access Reviews

- **Monthly:** Review `ADMIN_TELEGRAM_IDS` list — remove departed staff
- **Quarterly:** Rotate `CRON_SECRET` and `IMPERSONATE_SECRET`
- **On departure:** Immediately remove from all allow-lists and revoke active sessions

## 6. Audit Trail

Every access-control-relevant action is logged in `audit_logs`:
- `auth.failed` — failed initData verification (with IP)
- `staff.added` / `staff.removed`
- `admin.impersonate_started` / `admin.impersonate_ended`
- Retention: 2 years minimum

## 7. Off-boarding

When a staff member or admin leaves:
1. Owner removes them from Settings → Staff (or admin removes from `ADMIN_TELEGRAM_IDS`)
2. Any active sessions expire within 24 hours (initData expiry)
3. Impersonation tokens expire within their set duration (max 120 min)
4. No shared passwords or API keys to revoke (Telegram-based auth)
