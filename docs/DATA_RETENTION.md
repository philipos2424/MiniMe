# Data Retention Policy

**Effective:** May 2026

---

## Retention Periods

| Data Type | Active Retention | Archive | Deletion |
|-----------|-----------------|---------|----------|
| Customer messages | 18 months in DB | 18mo–5yr in Storage (JSONL) | After 5 years |
| AI agent thoughts | 6 months in DB | Not archived | After 6 months |
| Orders & payments | Indefinite | N/A | Only on business deletion |
| Customer profiles | While business active | N/A | On erasure request or business deletion |
| Audit logs | 2 years in DB | 2yr–7yr in Storage | After 7 years |
| Webhook dedup records | 30 days (auto-purged by cron) | N/A | Auto-deleted |
| API cost logs | 12 months | N/A | After 12 months |

## Automated Processes

The `data-retention` cron (weekly, Sundays 3am UTC) handles:
1. Archive messages older than 18 months → `storage/archives/messages/{year}/` as JSONL
2. Delete `agent_thoughts` older than 6 months
3. Delete `webhook_dedupe` records older than 30 days

Orders are **never** automatically deleted — they are accounting records.

## Business Deletion

On subscription cancellation, a business retains access for 30 days to export data. After 30 days:
- All customer PII is anonymized
- Messages are deleted
- Orders are anonymized (customer name replaced with "Deleted Customer")
- Products, settings, and bot config are deleted

## Data Subject Erasure (GDPR Art. 17)

When a customer requests erasure via the business owner:
1. `name` → "Deleted customer"
2. `phone`, `telegram_id`, `telegram_username` → null
3. `customer_memory` records → deleted
4. Inbound message content → "[deleted]"
5. Orders preserved (financial records), customer_id link anonymized

Audit log entry created for every erasure with timestamp and actor.

## Legal Basis for Retention

- **Orders & invoices:** 7 years (Ethiopian Commercial Code, Art. 14)
- **Audit logs:** 2 years minimum (SOC 2 requirement)
- **Messages:** Legitimate interest (dispute resolution, service improvement)
