-- Migration 035: Secretary on Free, with a monthly reply cap
--
-- Secretary used to be Pro-only, refused at the Telegram business_connection.
-- It is now available on Free with a monthly cap (SECRETARY_FREE_MONTHLY_CAP
-- in lib/plan.js). Pro is uncapped.
--
-- Two columns rather than a rolling count table: the cap is a soft guardrail on
-- AI spend, not billing, so a per-business counter with a period stamp is
-- enough and costs one UPDATE per secretary reply.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS secretary_replies_period TEXT,
  ADD COLUMN IF NOT EXISTS secretary_replies_count  INTEGER NOT NULL DEFAULT 0,
  -- Set when we've told the owner they hit the cap, so we say it once per
  -- period instead of on every subsequent message.
  ADD COLUMN IF NOT EXISTS secretary_cap_notified_period TEXT;

COMMENT ON COLUMN businesses.secretary_replies_period IS
  'Calendar month (YYYY-MM) that secretary_replies_count belongs to. Rolls over automatically.';

-- Atomic bump. Read-modify-write from the app would undercount when a shop gets
-- concurrent messages — two webhooks racing would both read N and write N+1.
-- Returns the count AFTER incrementing.
CREATE OR REPLACE FUNCTION secretary_reply_bump(biz_id UUID, period TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE businesses
  SET secretary_replies_count =
        CASE WHEN secretary_replies_period IS DISTINCT FROM period
             THEN 1
             ELSE secretary_replies_count + 1
        END,
      secretary_replies_period = period
  WHERE id = biz_id
  RETURNING secretary_replies_count INTO new_count;

  RETURN COALESCE(new_count, 0);
END;
$$;
