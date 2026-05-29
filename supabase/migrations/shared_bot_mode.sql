-- ============================================================
-- Shared bot mode: businesses can use @MiniMeAgentBot directly
-- instead of creating their own BotFather bot.
--
-- shop_code: unique short code for deep-link routing
--   t.me/MiniMeAgentBot?start=shop_XXXXXXXX
--
-- bot_mode: 'custom' (own bot), 'shared' (@MiniMeAgentBot), 'both'
-- ============================================================

-- Short code for deep-link routing
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS shop_code VARCHAR(20) UNIQUE;

-- Track which mode the business uses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS bot_mode VARCHAR(20) DEFAULT 'custom';

-- Index for fast shop_code lookup (WHERE clause skips NULLs)
CREATE INDEX IF NOT EXISTS idx_businesses_shop_code
  ON businesses(shop_code) WHERE shop_code IS NOT NULL;

-- Backfill: generate shop_code for existing businesses that don't have one
UPDATE businesses
SET shop_code = lower(substr(md5(id::text || now()::text), 1, 8))
WHERE shop_code IS NULL;
