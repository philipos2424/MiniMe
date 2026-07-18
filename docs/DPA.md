# Data Processing Agreement (DPA)

**Between:** MiniMe ("Processor")  
**And:** [Customer Business Name] ("Controller")  
**Effective:** [Date]

---

## 1. Subject Matter & Duration

MiniMe processes personal data on behalf of the Controller to provide the MiniMe AI business assistant service (the "Service") for the duration of the subscription agreement.

## 2. Nature & Purpose of Processing

MiniMe processes personal data solely to:
- Operate the AI bot that handles customer inquiries on behalf of the Controller
- Store conversation history, order data, and customer profiles
- Generate analytics and reports for the Controller
- Deliver payment processing via Chapa (sub-processor)

## 3. Categories of Data Subjects

- **Customers** of the Controller who message the Telegram bot
- **Employees/staff** of the Controller granted sub-admin access

## 4. Categories of Personal Data

| Category | Examples |
|----------|---------|
| Identity | Name, Telegram username/ID |
| Contact | Phone number |
| Transactional | Order history, amounts paid |
| Behavioral | Chat messages, response patterns |

**Excluded:** Special categories (health, biometric, financial account numbers, government IDs) — Controller must not collect these through the Service.

## 5. Processor Obligations

MiniMe shall:
a) Process personal data only on documented Controller instructions  
b) Ensure persons authorised to process the data are bound by confidentiality  
c) Implement technical and organisational security measures (see Section 7)  
d) Respect conditions for engaging sub-processors (Section 6)  
e) Assist the Controller in responding to data subject rights requests  
f) Delete or return all personal data upon termination  
g) Provide information necessary to demonstrate compliance  
h) Notify the Controller within 72 hours of becoming aware of a personal data breach  

## 6. Sub-processors

| Sub-processor | Role | Location |
|--------------|------|---------|
| Supabase | Database & Storage | AWS eu-central-2 (Germany) |
| Vercel | Application Hosting | United States / Edge |
| OpenAI | AI Inference | United States |
| Chapa | Payment Processing | Ethiopia |
| Addis AI | Amharic/Afan Oromo speech-to-text & translation | Ethiopia (unconfirmed) |
| Telegram | Bot API & Auth | Netherlands |

Controller authorises the above sub-processors. MiniMe will notify Controller 30 days before adding new sub-processors and Controller may object within that period.

## 7. Security Measures

MiniMe implements the following technical and organisational measures:

**Access control:** RBAC with three roles (owner, staff, platform admin). Authentication via Telegram cryptographic signatures. 24-hour token expiry. Admin actions audit-logged.

**Encryption:** TLS 1.3 in transit. AES-256 encryption at rest (Supabase default). Bot tokens additionally encrypted at the application layer (AES-256-GCM).

**Logging:** Immutable audit log of all sensitive operations (refunds, staff changes, broadcasts).

**Availability:** 99.9% SLA. Point-in-time recovery (PITR). Daily backups. 7-day retention.

**Vulnerability management:** SAST scanning on every code change. Dependency audits.

## 8. Data Subject Rights

MiniMe will assist the Controller in fulfilling data subject requests:
- **Access (Art. 15 GDPR):** Export via `/api/customers/[id]/export`
- **Erasure (Art. 17 GDPR):** Anonymization via `/api/customers/[id]/erase`
- **Portability (Art. 20 GDPR):** Export in JSON/CSV formats

## 9. International Transfers

Processing by OpenAI (US) is covered by:
- Standard Contractual Clauses (SCCs) — Module 2 (Controller to Processor)
- OpenAI's Data Processing Addendum (Enterprise agreement)

## 10. Termination

Upon termination of the Service:
- Controller may export all data via the business export function before termination
- MiniMe will delete all Controller data within 30 days of termination
- Audit logs retained for legal compliance period (2 years)

---

*Signed on behalf of MiniMe by:* _______________  
*Date:* _______________
