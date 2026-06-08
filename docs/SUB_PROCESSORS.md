# MiniMe — Sub-Processor List

**Last updated:** 2026-05-16

All sub-processors are contractually bound to protect personal data in accordance with GDPR Article 28.

---

| Sub-processor | Role | Data Processed | Location | Certifications |
|---|---|---|---|---|
| **Supabase** | Database, file storage | All customer and business data | EU-Central-2 (Frankfurt, AWS) | SOC 2 Type II, ISO 27001 |
| **Vercel** | Application hosting, edge functions | Request/response data, logs (ephemeral) | US-East-1 (AWS) | SOC 2 Type II |
| **OpenAI** | AI language model inference | Customer messages (no retention per enterprise DPA) | US | SOC 2 Type II |
| **Chapa** | Payment processing (Ethiopia) | Payment amounts, references (no card data) | Ethiopia / US | PCI-DSS Level 1 |
| **Telegram** | Messaging platform / auth | Customer messages, Telegram IDs | Dubai / US | — |
| **Hasab AI** | Amharic language translation (optional) | Customer messages (when Amharic detected) | Ethiopia | — |
| **Sentry** (planned) | Error tracking | Stack traces, sanitized error context | US | SOC 2 Type II |

---

## Data Flow

```
Customer (Telegram) → Telegram API → MiniMe Webhook (Vercel)
                                           ↓
                                     Supabase DB ← → OpenAI API
                                           ↓
                                   Chapa (payments)
```

**No customer card data ever reaches MiniMe.** Chapa handles all payment card processing. MiniMe stores only the payment reference (tx_ref) and order total.

---

## Changes to this list

We will notify customers at least 14 days in advance of adding new sub-processors that handle personal data. Changes are logged in the audit trail under action `admin.sub_processor_added`.
