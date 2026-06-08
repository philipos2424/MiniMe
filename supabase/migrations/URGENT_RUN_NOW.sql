-- ═══════════════════════════════════════════════════════════════════════════
-- 🚨 URGENT: Run this in Supabase Dashboard SQL editor IMMEDIATELY
-- https://supabase.com/dashboard/project/hbmesjhkczhqpbdseifd/sql
--
-- This fixes the signup failure ("create FAILED" error) by adding the 5
-- missing columns that the app code depends on.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. owner_instructions — behavior rules the bot follows (used everywhere)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS owner_instructions jsonb DEFAULT '[]'::jsonb;

-- 2. currency — default currency for prices (defaults to ETB)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS currency text DEFAULT 'ETB';

-- 3. meta — JSONB for misc metadata (staff_names, broadcast_history, etc.)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- 4. phone — business contact phone
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone text;

-- 5. language — preferred reply language (en, am, auto)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS language text DEFAULT 'auto';

-- ── ALSO add missing meta column to customers + conversations ───────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- ── Also create platform_feedback (for beta feedback widget) ────────────────
CREATE TABLE IF NOT EXISTS platform_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid REFERENCES businesses(id) ON DELETE SET NULL,
  owner_tg_id   bigint,
  nps_score     smallint CHECK (nps_score BETWEEN 0 AND 10),
  category      text CHECK (category IN ('bug','feature','general','praise')),
  note          text,
  page          text,
  app_version   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_feedback_business_idx ON platform_feedback (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_feedback_score_idx ON platform_feedback (nps_score, created_at DESC);
ALTER TABLE platform_feedback ENABLE ROW LEVEL SECURITY;

-- ── Also create rate_limits (for persistent rate limiting across cold starts) ──
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  max_requests integer NOT NULL DEFAULT 1,
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits (reset_at);

-- Refresh the PostgREST schema cache so the columns are immediately usable
NOTIFY pgrst, 'reload schema';
