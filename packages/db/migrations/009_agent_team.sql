-- 009_agent_team.sql — Team roster + agent brief storage
--
-- The Agent can only fan out to real people. This migration extends
-- `suppliers` so owners can register their team (designer, printer,
-- delivery, etc.) with contact handles the bot can DM, and extends
-- `job_steps` so we record the GPT-generated brief that was actually
-- sent plus the Telegram message_id returned — so supplier replies
-- can be routed back to the right step.
--
-- Also adds a `metadata` jsonb on `conversations` so the reply engine
-- can remember that it already asked a clarifying question (prevents
-- asking the same question twice).

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS role VARCHAR(32)
  CHECK (role IN ('designer','printer','delivery','photographer','writer','installer','catering','other'));
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS specialties TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(128);

ALTER TABLE job_steps ADD COLUMN IF NOT EXISTS brief TEXT;
ALTER TABLE job_steps ADD COLUMN IF NOT EXISTS supplier_message_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_suppliers_business_role
  ON suppliers(business_id, role) WHERE is_active = true;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
