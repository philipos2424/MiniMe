# MiniMe — Enterprise Security Vendor Questionnaire

**Product:** MiniMe — AI Telegram Business Assistant  
**Version:** 3.0 | **Date:** 2026-05-16  
**Contact:** security@minime.bot

---

## Section 1: Company & Product

**Q: What does your product do?**  
MiniMe is a Telegram Mini App that gives small and medium businesses an AI-powered assistant (Alfred) that handles customer messages, processes orders, generates payment links, manages inventory, and provides analytics — all via Telegram.

**Q: Where is data hosted?**  
- Application: Vercel (US-East, AWS us-east-1)
- Database: Supabase (EU-Central-2, AWS Frankfurt)
- AI processing: OpenAI API (US)
- Media storage: Supabase Storage (same as DB region)

**Q: Who are your sub-processors?**  
See `SUB_PROCESSORS.md` for the full list. Key processors: Supabase (database, storage), Vercel (hosting, edge functions), OpenAI (AI inference), Chapa (payment processing, Ethiopia).

---

## Section 2: Data

**Q: What personal data do you collect?**  
From end customers: Telegram ID, Telegram username, display name, phone number (optional, if provided during checkout), order history.  
From business owners: Telegram ID, Telegram username, business name, address, contact details, bot token (encrypted).

**Q: Where is data stored?**  
PostgreSQL via Supabase. EU-Central-2 region. All data encrypted at rest (AES-256) by Supabase.

**Q: Is data used for AI training?**  
No. We use OpenAI's API on the standard tier. Messages are not retained by OpenAI for training per their data processing agreement.

**Q: Data retention policy?**  
- Messages: 18 months active, then archived to cold storage
- Orders: Indefinite (accounting records)
- Audit logs: 2 years active, then archived
- webhook_dedupe: 24-hour TTL, auto-purged
- Business can delete all customer data on request

**Q: Do you support data subject access requests (DSAR)?**  
Yes. Business owners can export all data for a specific customer via the dashboard (customer profile → Export data). A right-to-erasure workflow is in development (Q3 2026).

**Q: Do you share data with third parties?**  
Only with sub-processors necessary to deliver the service (see `SUB_PROCESSORS.md`). No data sold or shared for advertising.

---

## Section 3: Authentication & Access Control

**Q: How do users authenticate?**  
Via Telegram Mini App `initData` (HMAC-SHA256, verified server-side against the bot token). Tokens expire after 24 hours.

**Q: Do you support MFA?**  
Authentication is handled by Telegram, which supports 2FA natively. We inherit Telegram's MFA status.

**Q: How do you control access?**  
- Owner vs. staff roles enforced at both API and bot-command level
- Every database query scoped to the authenticated business (multi-tenant isolation)
- Sub-admins blocked from all destructive operations (refunds, staff management, discount management)
- Platform admins have elevated access with full audit trail

**Q: Do you conduct access reviews?**  
Platform admin access is reviewed quarterly. Staff access changes are logged in the audit trail and visible to business owners.

---

## Section 4: Infrastructure & Operations

**Q: What is your uptime SLA?**  
We inherit Vercel's 99.99% uptime SLA and Supabase's 99.95% SLA. AI responses depend on OpenAI API availability.

**Q: How do you handle incidents?**  
See `INCIDENT_RESPONSE.md`. Summary: Sentry alerts → on-call team → Telegram admin notification → root cause analysis → post-mortem within 48 hours.

**Q: Do you have a disaster recovery plan?**  
Yes. Supabase Pro includes daily backups and point-in-time recovery (PITR) with up to 7-day retention. RPO: 1 hour. RTO: 4 hours.

**Q: Do you conduct penetration testing?**  
Internal security reviews are conducted with each major release. External penetration testing is planned for Q4 2026 after SOC 2 Type I certification.

**Q: Do you have a bug bounty program?**  
Responsible disclosure policy is published. Formal bug bounty program planned post-SOC 2.

---

## Section 5: Encryption

**Q: Encryption in transit?**  
All traffic uses TLS 1.2+, enforced by Vercel and Supabase.

**Q: Encryption at rest?**  
Database: AES-256 (Supabase managed).  
Bot tokens: AES-256-GCM at the application layer (random IV per encryption, auth tag verified on decryption).  
Customer PII encryption at the application layer: in development.

**Q: Key management?**  
Encryption keys stored as Vercel environment variables (encrypted at rest). Key rotation runbook documented. No keys hardcoded in source code.

---

## Section 6: Vendor & Supply Chain

**Q: Do your sub-processors have security certifications?**  

| Sub-processor | Certifications |
|---|---|
| Vercel | SOC 2 Type II |
| Supabase | SOC 2 Type II |
| OpenAI | SOC 2 Type II |
| Chapa | PCI-DSS (payment data) |

**Q: How do you vet new sub-processors?**  
All new sub-processors must have at minimum SOC 2 Type II or equivalent certification. Security review required before integration. Business owners notified of changes.

---

## Section 7: Compliance

**Q: Are you GDPR compliant?**  
Partially. Data subject access and deletion workflows are in development. Privacy policy and DPA (Data Processing Agreement) available on request.

**Q: Are you SOC 2 certified?**  
Not yet. SOC 2 Type I preparation in progress, target Q4 2026.

**Q: PCI-DSS?**  
MiniMe does not store, process, or transmit payment card data. Payment processing is handled entirely by Chapa (PCI-DSS certified). MiniMe only stores order records and payment references.

---

## Section 8: Contact

| Topic | Contact |
|---|---|
| Security vulnerabilities | security@minime.bot |
| Privacy & data requests | privacy@minime.bot |
| General enterprise inquiries | enterprise@minime.bot |
| Incident notification | security@minime.bot |
