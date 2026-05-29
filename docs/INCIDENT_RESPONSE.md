# MiniMe — Incident Response Runbook

**Version:** 1.0 | **Date:** 2026-05-16  
**Owner:** Platform Engineering  
**Contact:** security@minime.bot

---

## 1. Severity Levels

| Level | Definition | Response Time |
|---|---|---|
| **P0 — Critical** | Active data breach, production down, payment fraud, mass bot compromise | Immediate (< 15 min) |
| **P1 — High** | Bot outage for >50% of businesses, auth bypass, audit log failure | < 1 hour |
| **P2 — Medium** | Single bot down, elevated error rate, rate limit bypass | < 4 hours |
| **P3 — Low** | Minor feature bug, non-urgent security finding | Next business day |

---

## 2. Detection Sources

- **Sentry** — application errors, unhandled exceptions
- **Vercel** — function timeouts, build failures
- **Supabase** — query errors, connection pool exhaustion
- **Audit log** — unusual pattern of admin access or bulk deletions
- **Telegram** — bot error reports from clients
- **External** — vulnerability disclosure via security@minime.bot

---

## 3. Response Flow

```
DETECT (alert / user report)
     ↓
ACKNOWLEDGE (responder assigned, stakeholders notified)
     ↓
CONTAIN (isolate affected service, disable compromised tokens)
     ↓
INVESTIGATE (logs, Supabase queries, Sentry traces)
     ↓
ERADICATE (fix root cause, deploy patch)
     ↓
RECOVER (restore service, verify clean state)
     ↓
POST-MORTEM (within 48 hours, distributed to stakeholders)
```

---

## 4. Specific Playbooks

### 4a. Bot token compromise

1. Identify the affected business from the audit log or error report
2. Revoke the token: POST `https://api.telegram.org/bot<TOKEN>/deleteWebhook`
3. Set `businesses.telegram_bot_token_enc = null`, `bot_last_error = 'token_compromised'`
4. Notify owner via the PLATFORM bot: "Your bot token may be compromised. Please generate a new one from @BotFather and re-link."
5. Audit log: `bot.token_revoked` with reason
6. If ENCRYPTION_KEY was also compromised: rotate the key and re-encrypt all tokens (see `docs/key-rotation.md`)

### 4b. Data breach (database exposed)

1. Immediately rotate: Supabase service role key, all Vercel env vars
2. Revoke all active Supabase connections
3. Run: `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 1000` to assess what was accessed
4. Notify affected businesses within 72 hours (GDPR Art. 33)
5. File breach notification with relevant DPA (Data Protection Authority)
6. Engage Supabase support for forensics assistance

### 4c. Authentication bypass

1. Identify affected endpoints from Vercel logs
2. Deploy hotfix disabling the vulnerable endpoint
3. Rotate `TELEGRAM_BOT_TOKEN` (invalidates all existing initData)
4. Scan audit_logs for suspicious actor_type=`owner` entries from unknown IPs
5. Notify all business owners if their data may have been accessed

### 4d. Mass bot outage (bots not replying)

1. Check Vercel status page (status.vercel.com)
2. Check Supabase status page (status.supabase.com)
3. Check OpenAI status page (status.openai.com)
4. Run test webhook against a known-good business
5. Check `agent_thoughts` for recent `no reply` outcomes — if high rate, suspect LLM issue
6. If OpenAI is down: deploy fallback that sends "I'll get back to you shortly" to all pending messages

---

## 5. Communication Templates

### To affected business owners (P0/P1)

> Dear [Business Name],
>
> We detected an incident affecting MiniMe on [date]. [Brief description of impact].
>
> **What happened:** [1-2 sentences]
> **What data was affected:** [specific data types]
> **What we've done:** [actions taken]
> **What you should do:** [any action required from them]
>
> We apologize for the disruption. For questions: security@minime.bot
>
> — MiniMe Security Team

### Internal stakeholder update (every 30 min during P0)

> **[TIME] INCIDENT UPDATE — P0**
> Status: [Investigating / Contained / Resolving / Resolved]
> Impact: [businesses affected / data exposed / features down]
> Actions taken: [bullet list]
> Next update: [time]

---

## 6. Post-Mortem Template

**Incident:** [Title]  
**Date/Time:** [UTC]  
**Duration:** [from detection to resolution]  
**Severity:** [P0/P1/P2/P3]  
**Author:** [name]  

**Timeline:**
- HH:MM — [event]

**Root cause:**

**Contributing factors:**

**Impact:**
- Businesses affected:
- Customer messages dropped:
- Data exposed (if any):

**What went well:**

**What went wrong:**

**Action items:**
| Action | Owner | Due Date |
|---|---|---|

---

## 7. Contacts

| Role | Contact |
|---|---|
| Security incidents | security@minime.bot |
| Supabase support | support.supabase.com |
| Vercel support | vercel.com/support |
| OpenAI incident | platform.openai.com/docs/guides/safety-best-practices |
| Legal / DPA filing | [add local DPA contact] |
