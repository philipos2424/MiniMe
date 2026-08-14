-- Migration 044: marketing/sales outreach + proactive feedback prompts
--
-- Generalizes two existing, disconnected pieces — the hardcoded
-- cron/owner-nudges rule engine (JSONB-blob cooldown state on
-- businesses.notification_prefs, not admin-editable) and the deprecated
-- apps/bot trial-checker (working trial-stage nudges that aren't deployed
-- anywhere in the live apps/web app) — into one admin-configurable rule
-- engine, plus lets admins compose one-off manual campaigns and schedule
-- proactive feedback prompts on the same engine.
--
-- Reuses rather than duplicates: businesses.owner_telegram_id /
-- owner_private_chat_id (send target), businesses.notification_prefs
-- (single opt-out source of truth, unchanged), businesses.trial_warn_stage
-- (trial-stage idempotency, unchanged), platform_feedback (feedback
-- storage), audit_logs (via lib/server/audit.js).

-- Admin-editable rule-based auto-trigger definitions.
CREATE TABLE IF NOT EXISTS outreach_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                   TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  description           TEXT,
  kind                  TEXT NOT NULL CHECK (kind IN ('nudge', 'feedback_prompt')),
  trigger_type          TEXT NOT NULL CHECK (trigger_type IN (
                          'days_since_signup', 'days_since_active', 'trial_stage',
                          'usage_milestone', 'plan_tier', 'inactivity'
                        )),
  trigger_config        JSONB NOT NULL DEFAULT '{}',
  message_template      TEXT NOT NULL,
  feedback_prompt_kind  TEXT CHECK (feedback_prompt_kind IN ('nps', 'category', 'free_text')),
  cooldown_days         INTEGER NOT NULL DEFAULT 21,
  max_sends             INTEGER NOT NULL DEFAULT 2,
  priority              INTEGER NOT NULL DEFAULT 100,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE outreach_rules IS
  'Admin-configurable auto-trigger rules for platform-to-owner outreach. One rule fires at most once per business per cooldown window; see outreach_sends for the dedupe ledger.';

-- One-off manual campaigns composed by an admin (extends notify-owners'
-- existing segment/send logic with persistence + scheduling; see
-- lib/server/outreach.js for the shared selectRecipients/send-loop code).
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  message          TEXT NOT NULL,
  segment_filter   JSONB NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_for    TIMESTAMPTZ,
  created_by       TEXT NOT NULL,
  sent_at          TIMESTAMPTZ,
  recipient_count  INTEGER,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unified send log for BOTH rule fires and manual campaign sends. This is
-- the single dedupe/cooldown source of truth and the admin history/
-- analytics table — the JSONB-blob approach in notification_prefs.owner_nudges
-- can't answer "show me every send to this business" or "what's the
-- response rate of this rule", a real table can.
CREATE TABLE IF NOT EXISTS outreach_sends (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_type      TEXT NOT NULL CHECK (source_type IN ('rule', 'campaign')),
  rule_id          UUID REFERENCES outreach_rules(id) ON DELETE SET NULL,
  campaign_id      UUID REFERENCES outreach_campaigns(id) ON DELETE SET NULL,
  rule_key         TEXT,
  status           TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_optout', 'skipped_cooldown', 'blocked')),
  telegram_error   TEXT,
  message_preview  TEXT,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_sends_biz_rule ON outreach_sends(business_id, rule_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_sends_campaign ON outreach_sends(campaign_id);

-- Log of feedback prompts sent, so response rate can be computed even for
-- prompts that never got a reply (platform_feedback only gets a row when
-- the owner actually responds).
CREATE TABLE IF NOT EXISTS feedback_prompts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_id           UUID REFERENCES outreach_rules(id) ON DELETE SET NULL,
  outreach_send_id  UUID REFERENCES outreach_sends(id) ON DELETE SET NULL,
  prompt_token      TEXT UNIQUE NOT NULL,
  responded_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_prompts_business ON feedback_prompts(business_id);

-- Attribution on the existing feedback table — nullable, so organic/opt-in
-- feedback (the vast majority today) is completely unaffected.
ALTER TABLE platform_feedback
  ADD COLUMN IF NOT EXISTS feedback_prompt_id UUID REFERENCES feedback_prompts(id) ON DELETE SET NULL;

-- Seed rules, ported from apps/bot/src/cron/trial-checker.js (which is not
-- deployed anywhere live — see cron/outreach-rules/route.js). Priority is
-- ordered so the furthest-progressed stage always wins when a business
-- qualifies for more than one (e.g. daysLeft=1 satisfies both the day-1 and
-- day-7 warn thresholds) — lowest priority number is evaluated first.
INSERT INTO outreach_rules (key, name, description, kind, trigger_type, trigger_config, message_template, cooldown_days, max_sends, priority, enabled) VALUES
  ('trial_day7', 'Trial: 7 days left', 'Warn stage 1 of 3 — ported from trial-checker.js', 'nudge', 'trial_stage',
   '{"phase":"warn","at_or_below_days":7,"stage_value":7}',
   E'⏳ Hi {{owner_name}},\n\nYour free month for *{{business_name}}* ends in *7 days*.\n\nOn Free, MiniMe keeps writing every customer reply for you — that never stops. The difference: you''ll be the one tapping send.\n\n/upgrade to keep it fully automatic.',
   365, 1, 10, true),
  ('trial_day3', 'Trial: 3 days left', 'Warn stage 2 of 3 — ported from trial-checker.js', 'nudge', 'trial_stage',
   '{"phase":"warn","at_or_below_days":3,"stage_value":3}',
   E'⏳ Hi {{owner_name}},\n\nYour free month for *{{business_name}}* ends in *3 days*.\n\nOn Free, MiniMe keeps writing every customer reply for you — that never stops. The difference: you''ll be the one tapping send.\n\n/upgrade to keep it fully automatic.',
   365, 1, 20, true),
  ('trial_day1', 'Trial: 1 day left', 'Warn stage 3 of 3 — ported from trial-checker.js', 'nudge', 'trial_stage',
   '{"phase":"warn","at_or_below_days":1,"stage_value":1}',
   E'⏳ Hi {{owner_name}},\n\nYour free month for *{{business_name}}* ends tomorrow.\n\nOn Free, MiniMe keeps writing every customer reply for you — that never stops. The difference: you''ll be the one tapping send.\n\n/upgrade to keep it fully automatic.',
   365, 1, 30, true),
  ('trial_expired', 'Trial just expired', 'Drop-to-Free notice — ported from trial-checker.js', 'nudge', 'trial_stage',
   '{"phase":"expired","stage_value":0}',
   E'ℹ️ Hi {{owner_name}},\n\nYour free month for *{{business_name}}* is over — you''re now on *MiniMe Free*.\n\nNothing has been switched off: MiniMe still reads every message and writes the reply, unlimited.\n\nFrom now on you''ll get each reply to check and send yourself.\n\n/upgrade and MiniMe goes back to sending them for you.',
   365, 1, 40, true),
  ('trial_winback30', 'Win-back: 30 days on Free', 'Win-back stage — ported from trial-checker.js', 'nudge', 'trial_stage',
   '{"phase":"winback","after_days":30,"stage_value":-30}',
   E'👋 Hi {{owner_name}},\n\nMiniMe has kept writing replies for *{{business_name}}* — and you''ve tapped send on every one.\n\nOn Pro they just go out. Nights, Sundays, while you''re with a customer.\n\n/upgrade whenever you''re ready.',
   365, 1, 50, true),
  ('trial_winback7', 'Win-back: 7 days on Free', 'Win-back stage — ported from trial-checker.js', 'nudge', 'trial_stage',
   '{"phase":"winback","after_days":7,"stage_value":-7}',
   E'👋 Hi {{owner_name}},\n\nMiniMe has kept writing replies for *{{business_name}}* — and you''ve tapped send on every one.\n\nOn Pro they just go out. Nights, Sundays, while you''re with a customer.\n\n/upgrade whenever you''re ready.',
   365, 1, 60, true),
  ('feedback_day3', 'Feedback: 3 days in', 'Early proactive feedback ask', 'feedback_prompt', 'days_since_signup',
   '{"days":3}',
   E'Hi {{owner_name}} 👋\n\nYou''ve had *{{business_name}}* on MiniMe for a few days now — how''s it going so far? Thirty seconds of feedback helps us fix what''s annoying before it costs you a sale.',
   365, 1, 200, true),
  ('feedback_day30', 'Feedback: 30 days in', 'One-month proactive feedback ask', 'feedback_prompt', 'days_since_signup',
   '{"days":30}',
   E'Hi {{owner_name}} 👋\n\nIt''s been a month with *{{business_name}}* on MiniMe. What''s working, what isn''t? Your answer shapes what we build next.',
   365, 1, 210, true)
ON CONFLICT (key) DO NOTHING;
