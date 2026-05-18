-- Rate limits table for persistent rate limiting across cold starts
-- Run in Supabase Dashboard → SQL Editor
-- https://supabase.com/dashboard/project/hbmesjhkczhqpbdseifd/sql

CREATE TABLE IF NOT EXISTS rate_limits (
  key          text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  max_requests integer NOT NULL DEFAULT 1,
  reset_at     timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Auto-clean expired entries
CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits (reset_at);

-- No RLS needed — only service role accesses this
ALTER TABLE rate_limits DISABLE ROW LEVEL SECURITY;
