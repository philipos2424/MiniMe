-- MiniMe Agent Bot — Telegram Business API connection
-- Run in Supabase SQL Editor

-- Column stores the business_connection_id from Telegram's Business API.
-- Set when an owner connects their personal Telegram account to the MiniMe bot
-- via Settings → Business → Chatbots. Cleared when they disconnect.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS telegram_biz_conn_id TEXT;

-- Fast lookup: find business by connection ID when a business_message arrives
CREATE INDEX IF NOT EXISTS idx_biz_telegram_conn
  ON businesses(telegram_biz_conn_id)
  WHERE telegram_biz_conn_id IS NOT NULL;
