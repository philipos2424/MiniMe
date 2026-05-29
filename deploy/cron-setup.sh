#!/bin/bash
# ============================================================
# MiniMe Cron Jobs Setup (VPS version)
# On VPS, crons run as HTTP requests to the app
# This allows MUCH more frequent scheduling than Vercel Hobby
# ============================================================

DOMAIN="https://your-domain.com"
CRON_SECRET="your_cron_secret"  # Must match CRON_SECRET in .env.local

# Remove old cron jobs
crontab -r 2>/dev/null || true

# Install new cron jobs
(
  # Healthcheck + auto-heal broken bots: every 15 minutes
  echo "*/15 * * * * curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/healthcheck' >> /tmp/minime-cron.log 2>&1"

  # Morning briefing: 8am EAT (5am UTC) daily
  echo "0 5 * * * curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/morning-briefing' >> /tmp/minime-cron.log 2>&1"

  # Follow-ups: 9am EAT (6am UTC) daily
  echo "0 6 * * * curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/followups' >> /tmp/minime-cron.log 2>&1"

  # Reminders: 10am EAT (7am UTC) daily
  echo "0 7 * * * curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/reminders' >> /tmp/minime-cron.log 2>&1"

  # Auto-learn: 6am EAT (3am UTC) daily
  echo "0 3 * * * curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/auto-learn' >> /tmp/minime-cron.log 2>&1"

  # Birthdays: 7am EAT (4am UTC) daily
  echo "0 4 * * * curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/birthdays' >> /tmp/minime-cron.log 2>&1"

  # Weekly digest: Monday 8am EAT (5am UTC)
  echo "0 5 * * 1 curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/weekly-digest' >> /tmp/minime-cron.log 2>&1"

  # Self-improve: Monday 7am EAT (4am UTC)
  echo "0 4 * * 1 curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/self-improve' >> /tmp/minime-cron.log 2>&1"

  # LLM stats: 9am EAT (6am UTC) daily
  echo "0 6 * * * curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/llm-stats' >> /tmp/minime-cron.log 2>&1"

  # Data retention: Sunday 6am EAT (3am UTC)
  echo "0 3 * * 0 curl -sf -H 'Authorization: Bearer $CRON_SECRET' '$DOMAIN/api/cron/data-retention' >> /tmp/minime-cron.log 2>&1"

  # Clean up old cron logs weekly
  echo "0 0 * * 0 truncate -s 0 /tmp/minime-cron.log"
) | crontab -

echo "✅ Cron jobs installed! Run 'crontab -l' to verify"
echo ""
echo "Key upgrade vs Vercel:"
echo "  - Healthcheck: every 15min (was: daily)"
echo "  - All 10 crons running on precise Ethiopian schedule"
