-- MiniMe — subscription history, for real churn / trial→paid metrics.
-- Run in Supabase SQL Editor.
--
-- /api/admin/economics has always approximated churn and trial conversion
-- off businesses.subscription_status + updated_at (a snapshot, not a
-- history) — a trial that converted then churned reads as "never
-- converted". This table gives it real point-in-time events to compute
-- from instead. No RLS policies beyond enabling it: every write goes
-- through the service-role client from trusted server code.

CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN
    ('trial_started', 'trial_converted', 'subscribed', 'renewed', 'churned', 'expired')),
  plan TEXT,
  amount_etb NUMERIC,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_biz ON subscription_events(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_events_type ON subscription_events(event, created_at DESC);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
