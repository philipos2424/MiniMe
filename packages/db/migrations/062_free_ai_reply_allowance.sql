-- Migration 062: Free plan runs the full agent for 100 AI replies a month
--
-- Free used to be capped at drafts (MiniMe writes, owner taps send). It now
-- runs at the owner's chosen trust level — MiniMe sends replies itself — for
-- the first FREE_LIMITS.aiRepliesPerMonth AI replies of each calendar month
-- (lib/plan.js), then falls back to drafts until the month rolls over. Pro is
-- uncapped. Every AI reply counts, drafts included.
--
-- Same shape as 035_secretary_free_cap: a per-business counter with a period
-- stamp, bumped atomically. The app treats a missing counter as "allowance
-- used", so this migration can land before or after the code.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS ai_replies_period TEXT,
  ADD COLUMN IF NOT EXISTS ai_replies_count  INTEGER NOT NULL DEFAULT 0,
  -- Set when the owner was told the free allowance ran out, so it's said once
  -- per month rather than on every message after.
  ADD COLUMN IF NOT EXISTS ai_replies_cap_notified_period TEXT;

COMMENT ON COLUMN businesses.ai_replies_period IS
  'Calendar month (YYYY-MM, UTC) that ai_replies_count belongs to. Rolls over automatically.';

-- Atomic bump; returns the count AFTER incrementing.
CREATE OR REPLACE FUNCTION ai_reply_bump(biz_id UUID, period TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE businesses
  SET ai_replies_count =
        CASE WHEN ai_replies_period IS DISTINCT FROM period
             THEN 1
             ELSE ai_replies_count + 1
        END,
      ai_replies_period = period
  WHERE id = biz_id
  RETURNING ai_replies_count INTO new_count;

  RETURN COALESCE(new_count, 0);
END;
$$;

-- Server-side only: the service role calls it; owners' clients never do.
REVOKE ALL ON FUNCTION ai_reply_bump(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_reply_bump(UUID, TEXT) TO service_role;
