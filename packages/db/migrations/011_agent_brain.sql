-- 011_agent_brain.sql — Autonomous reasoning mode.
--
-- Turns on tool-calling agent loop for a business. When brain_mode is on,
-- Alfred stops following the rigid detect→brief pipeline and instead
-- reasons each turn: inspects state, picks tools (reply, ask_question,
-- brief_supplier, create_job, forward_file, notify_owner, mark_step_done),
-- and executes them. Keeps a short rolling memory of its own thoughts so
-- it can plan across turns.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brain_mode BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS agent_thoughts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,

  trigger      VARCHAR(32),     -- 'customer_msg' | 'supplier_reply' | 'manual' | 'cron'
  reasoning    TEXT,            -- the model's internal planning text
  tool_calls   JSONB DEFAULT '[]'::jsonb,
  outcome      TEXT,            -- human-readable summary
  tokens_used  INTEGER,
  model        VARCHAR(32) DEFAULT 'gpt-4o',
  duration_ms  INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_thoughts_biz
  ON agent_thoughts(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_thoughts_conv
  ON agent_thoughts(conversation_id, created_at DESC);
