-- 008_jobs.sql — Autonomous multi-step job orchestration
--
-- A `job` is one client request the agent handles end-to-end by fanning
-- out to suppliers (designer, printer, delivery, etc). Each `job_step`
-- is a unit of work — either auto-sent by the agent or waiting on a
-- person. `job_threads` stores the conversations (agent↔client, agent↔supplier)
-- so the UI can show them grouped per job.

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  deadline        TIMESTAMPTZ,
  budget          NUMERIC(12,2),
  actual_cost     NUMERIC(12,2),
  currency        VARCHAR(10) DEFAULT 'ETB',

  status          VARCHAR(20) DEFAULT 'draft'
    CHECK (status IN ('draft','awaiting_approval','active','blocked','completed','cancelled')),
  current_step    INTEGER DEFAULT 0,

  client_snapshot JSONB DEFAULT '{}'::jsonb,  -- cached {name, contact, etc}
  payload         JSONB DEFAULT '{}'::jsonb,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS jobs_business_idx ON jobs(business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_customer_idx ON jobs(customer_id);

-- ────────────────────────────── Steps ──────────────────────────────
CREATE TABLE IF NOT EXISTS job_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  order_index INTEGER NOT NULL,
  label       VARCHAR(255) NOT NULL,   -- "Brief designer", "Arrange delivery"
  icon        VARCHAR(8),              -- emoji
  role        VARCHAR(32),             -- "client"|"designer"|"printer"|"delivery"|"agent"|<freeform>
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,

  auto        BOOLEAN DEFAULT TRUE,     -- true = agent will send, false = waiting on person
  status      VARCHAR(20) DEFAULT 'idle'
    CHECK (status IN ('idle','active','waiting','done','failed','skipped')),

  outbound_summary TEXT,     -- what the agent sent
  inbound_summary  TEXT,     -- what came back
  data             JSONB DEFAULT '{}'::jsonb,

  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_steps_job_idx ON job_steps(job_id, order_index);

-- ────────────────────────────── Threads ──────────────────────────────
-- Each thread = one conversation thread the agent is running on behalf of
-- the owner (agent↔client, agent↔designer, etc).
CREATE TABLE IF NOT EXISTS job_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  contact_type VARCHAR(16) NOT NULL,    -- 'customer' | 'supplier'
  customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id  UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  role         VARCHAR(32),
  title        VARCHAR(255),

  messages JSONB DEFAULT '[]'::jsonb,    -- [{from, text, time, auto, attach}]

  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_threads_job_idx ON job_threads(job_id);

-- ────────────────────────────── Activity log ──────────────────────────────
CREATE TABLE IF NOT EXISTS job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  kind     VARCHAR(32) NOT NULL,       -- 'auto_sent'|'received'|'approved'|'analyzed'|...
  icon     VARCHAR(8),
  title    VARCHAR(255) NOT NULL,
  body     TEXT,
  auto     BOOLEAN DEFAULT TRUE,
  color    VARCHAR(16) DEFAULT 'green',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_events_job_idx ON job_events(job_id, created_at DESC);

-- ────────────────────────────── updated_at trigger ──────────────────────────────
CREATE OR REPLACE FUNCTION touch_jobs_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jobs_touch_updated ON jobs;
CREATE TRIGGER jobs_touch_updated BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION touch_jobs_updated_at();
