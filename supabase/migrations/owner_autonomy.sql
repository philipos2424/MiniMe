-- ═══════════════════════════════════════════════════════════════════════════
-- Owner Autonomy: auto-follow-up tracking on B2B messages so the system
-- can nudge non-responders before giving up.
-- Owner facts (durable preferences) live inside notification_prefs jsonb,
-- so no schema change is needed for them.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE business_messages
  ADD COLUMN IF NOT EXISTS follow_up_count integer NOT NULL DEFAULT 0;

ALTER TABLE business_messages
  ADD COLUMN IF NOT EXISTS last_follow_up_at timestamptz;

CREATE INDEX IF NOT EXISTS bm_followup_sweep_idx
  ON business_messages (status, delivered_at, follow_up_count)
  WHERE status = 'delivered';

NOTIFY pgrst, 'reload schema';
