-- MiniMe Market — usage events for the customer-facing marketplace Mini App.
-- Run in Supabase SQL Editor.
--
-- One row per marketplace interaction. Feeds the Pulse dashboard's market
-- cards/feed and the per-user "For you" recommendations (interest profile is
-- derived from these events + search_logs at read time — no profile table).

CREATE TABLE IF NOT EXISTS market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN ('view_market','view_product','click_chat')),
  business_id UUID,
  product_id UUID,
  tg_user_id TEXT,          -- Telegram user id when opened inside Telegram; null on plain web
  meta JSONB,               -- { q, category } etc.
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_events_created ON market_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_events_biz ON market_events(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_events_user ON market_events(tg_user_id) WHERE tg_user_id IS NOT NULL;
