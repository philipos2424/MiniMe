-- Migration 018: LLM call audit log + per-route rollback state.
-- Append-only, used to measure cost reduction and trigger auto-rollback
-- when a downgraded route's failure rate exceeds 5% over the last 50 calls.

CREATE TABLE IF NOT EXISTS llm_call_log (
  id              BIGSERIAL PRIMARY KEY,
  business_id     UUID,
  route           TEXT,
  model           TEXT,
  ok              BOOLEAN,
  latency_ms      INTEGER,
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  total_cost_usd  NUMERIC(10, 6),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS llm_call_log_route_created_idx
  ON llm_call_log(route, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_call_log_business_created_idx
  ON llm_call_log(business_id, created_at DESC) WHERE business_id IS NOT NULL;

-- Auto-rollback state: tracks which routes have been forcibly bumped back to MODEL.
CREATE TABLE IF NOT EXISTS llm_route_state (
  route             TEXT PRIMARY KEY,
  forced_model      TEXT,                    -- if set, overrides the route's normal model
  failures_recent   INTEGER DEFAULT 0,
  rollback_reason   TEXT,
  rolled_back_at    TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
