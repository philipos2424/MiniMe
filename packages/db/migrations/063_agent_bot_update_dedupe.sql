-- Migration 063: idempotency for the shared @MiniMeAgentBot webhook
--
-- Telegram re-delivers an update when the webhook doesn't answer in time.
-- Shop bots already skip those repeats via webhook_dedupe, but that table is
-- keyed by (business_id, update_id) with a foreign key to businesses, and the
-- shared bot only learns which business an update belongs to after parsing
-- it. One bot means one update_id sequence, so update_id alone is the key.
--
-- The webhook fails open if this table is missing, so this migration can land
-- before or after the code. The data-retention cron purges rows after 30 days.
CREATE TABLE IF NOT EXISTS agent_bot_update_dedupe (
  update_id    BIGINT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_bot_update_dedupe_processed_at
  ON agent_bot_update_dedupe (processed_at);

-- Server-only, like every other table: RLS on, no policies, so the anon key
-- can neither read nor write it. The service role bypasses RLS.
ALTER TABLE agent_bot_update_dedupe ENABLE ROW LEVEL SECURITY;
