# MiniMe — SOC 2 Gap Analysis

**Trust Service Criteria:** Security (CC), Availability (A), Processing Integrity (PI), Confidentiality (C), Privacy (P)  
**Date:** 2026-05-16 | **Status:** Pre-audit gap analysis

---

## CC1 — Control Environment

| Criterion | Status | Gap / Note |
|---|---|---|
| CC1.1 COSO Principle 1 — Commitment to integrity | 🟡 Partial | Code of conduct not documented. Security team roles not formalized. |
| CC1.2 Board oversight | 🔴 Not started | No board or governance structure yet. |
| CC1.3 Organizational structure | 🟡 Partial | Roles exist (owner, staff, platform admin) but not documented in an org chart. |
| CC1.4 HR policies | 🔴 Not started | No formal background checks, employment agreements, or security training program. |

---

## CC2 — Communication & Information

| Criterion | Status | Gap / Note |
|---|---|---|
| CC2.1 Relevant information available | 🟢 Done | Security.md, DPA, privacy policy created. |
| CC2.2 Internal communication | 🟡 Partial | No formal security awareness training cadence. Slack/Telegram used informally. |
| CC2.3 External communication | 🟢 Done | Vulnerability disclosure policy published. Enterprise contact email established. |

---

## CC3 — Risk Assessment

| Criterion | Status | Gap / Note |
|---|---|---|
| CC3.1 Risk identification | 🟡 Partial | Security audit completed (this document). No formal risk register. |
| CC3.2 Risk analysis | 🟡 Partial | Audit surfaced critical gaps; severity rated informally. No formal risk scoring (CVSS etc.). |
| CC3.3 Risk response | 🟢 Done | Phase 1-6 plan addresses all critical findings. |
| CC3.4 Change management | 🔴 Not started | No formal change management process (GitHub PRs serve as informal log). |

---

## CC4 — Monitoring Activities

| Criterion | Status | Gap / Note |
|---|---|---|
| CC4.1 Ongoing monitoring | 🟡 Partial | Vercel logs + Sentry (planned). No SIEM. No automated alerting on anomalies. |
| CC4.2 Evaluation of deficiencies | 🔴 Not started | No formal deficiency tracking or remediation timeline process. |

---

## CC5 — Control Activities

| Criterion | Status | Gap / Note |
|---|---|---|
| CC5.1 Define controls | 🟡 Partial | Controls exist (RLS, auth, rate limiting) but not formally documented as a control catalog. |
| CC5.2 IT controls | 🟢 Done | Auth, multi-tenancy, encryption, audit logging all implemented. |
| CC5.3 Deployment controls | 🟡 Partial | Vercel deploy previews + manual review. No automated security scanning in CI pipeline. |

---

## CC6 — Logical Access Controls

| Criterion | Status | Gap / Note |
|---|---|---|
| CC6.1 Restrict logical access | 🟢 Done | Owner/staff roles enforced at API and bot level. Sub-admin gates on destructive endpoints. |
| CC6.2 Authentication | 🟢 Done | HMAC-SHA256 initData, 24h expiry, constant-time webhook verification. |
| CC6.3 Registration / removal of users | 🟢 Done | Staff management UI with audit log. Admin allowlist managed in DB. |
| CC6.4 Access restrictions | 🟢 Done | Every query scoped by business_id. RLS as second layer. |
| CC6.5 Identification of logical access risks | 🟡 Partial | Race conditions fixed with upsert + unique constraints. Timing attack fixed. |
| CC6.6 Infrastructure logical access | 🟡 Partial | Supabase + Vercel access not formally reviewed. MFA not mandated for infra access. |
| CC6.7 Encryption of data in transit/rest | 🟡 Partial | In-transit: ✅. At-rest DB: ✅. Application-layer PII encryption: planned Q3 2026. |
| CC6.8 Prevention of unauthorized software | 🟡 Partial | npm lock file enforced. No dependency vulnerability scanning (Snyk/Dependabot). |

---

## CC7 — System Operations

| Criterion | Status | Gap / Note |
|---|---|---|
| CC7.1 Vulnerability detection | 🔴 Not started | No automated SAST/DAST or dependency scanning in CI. |
| CC7.2 Anomaly monitoring | 🟡 Partial | Sentry planned. Failed auth events logged. No automated alerting thresholds. |
| CC7.3 Evaluation of security events | 🔴 Not started | No formal incident triage process or runbook ownership. |
| CC7.4 Incident response | 🟡 Partial | INCIDENT_RESPONSE.md created. Not yet tested via tabletop exercise. |
| CC7.5 Disclosure of breaches | 🟡 Partial | Commitment to 48h notification in security policy. No tested notification workflow. |

---

## CC8 — Change Management

| Criterion | Status | Gap / Note |
|---|---|---|
| CC8.1 Change authorization | 🟡 Partial | GitHub PRs as informal approval. No security review gate in CI for production changes. |

---

## CC9 — Risk Mitigation

| Criterion | Status | Gap / Note |
|---|---|---|
| CC9.1 Vendor risk management | 🟢 Done | Sub-processor list with certifications documented. |
| CC9.2 Business partner obligations | 🟡 Partial | DPA template created. Not yet counter-signed by all enterprise customers. |

---

## Availability (A1)

| Criterion | Status | Gap / Note |
|---|---|---|
| A1.1 Commitments | 🟡 Partial | Vercel 99.99% + Supabase 99.95% inherited. No formal MiniMe SLA published. |
| A1.2 Capacity management | 🟡 Partial | N+1 fixed. Concurrency locks implemented. No formal load testing results yet. |
| A1.3 Backup and recovery | 🟢 Done | Supabase PITR (7 days). RPO 1h, RTO 4h documented. |

---

## Privacy (P1-P8)

| Criterion | Status | Gap / Note |
|---|---|---|
| P1.1 Privacy notice | 🟡 Partial | PRIVACY.md created but not yet published on website. |
| P3.1 Collection | 🟡 Partial | Minimal collection (Telegram ID, name, phone). No consent banner on first contact. |
| P4.1 Use of personal info | 🟢 Done | Data used solely to operate the service. Not sold or shared. |
| P5.1 Retention | 🟡 Partial | Retention policy documented. Automated deletion/archival cron in development. |
| P6.1 Disclosure | 🟡 Partial | Sub-processor list maintained. No third-party disclosure beyond sub-processors. |
| P7.1 Data quality | 🟡 Partial | Customer can update their profile via the business dashboard. No self-service for customers yet. |
| P8.1 Monitoring | 🟡 Partial | Audit log tracks owner data access. Customer access requests not yet formalized. |

---

## Summary

| Category | Done | Partial | Not Started |
|---|---|---|---|
| Control Environment | 0 | 2 | 2 |
| Communication | 2 | 1 | 0 |
| Risk Assessment | 1 | 2 | 1 |
| Monitoring | 0 | 1 | 1 |
| Control Activities | 1 | 2 | 0 |
| **Logical Access** | **5** | **3** | **0** |
| System Operations | 0 | 2 | 2 |
| Change Management | 0 | 1 | 0 |
| Risk Mitigation | 1 | 1 | 0 |
| Availability | 1 | 2 | 0 |
| Privacy | 1 | 6 | 0 |

**Overall readiness: ~55% of SOC 2 criteria met or partially met.**

**Priority remediations before Type I audit:**
1. Implement automated dependency scanning (Dependabot or Snyk)
2. Add Sentry error tracking with PII scrubbing
3. Formal risk register
4. Tabletop incident response exercise
5. CI security gate (required approval for production deploys)
6. Publish privacy policy and consent flow
7. PII encryption at rest (application layer)
