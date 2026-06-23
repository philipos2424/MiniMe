-- 026_onboarding_events.sql
-- Funnel telemetry table for the onboarding wizard.
-- Each wizard screen advance writes one row so the admin funnel dashboard can
-- show where owners drop off. Previously missing — the code wrote to this
-- table but it was never created, so all inserts and reads failed silently.

CREATE TABLE IF NOT EXISTS onboarding_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id BIGINT,
  step       TEXT NOT NULL,
  meta       JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_created
  ON onboarding_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_telegram
  ON onboarding_events (telegram_id);
