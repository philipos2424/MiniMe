-- MiniMe Market — engagement: favorites, shop follows, richer event types.
-- Run in Supabase SQL Editor.
--
-- market_favorites: a customer hearts a product (Saved tab in the Market).
-- market_follows:   a customer follows a shop inside the Market.
-- market_events:    CHECK widened so favorite/share/follow/view_shop/review
--                   interactions land in the same analytics stream the
--                   Pulse dashboard and per-business insights read from.

-- 1. Favorites (heart a product)
CREATE TABLE IF NOT EXISTS market_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_user_id TEXT NOT NULL,
  product_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_favorites_unique ON market_favorites(tg_user_id, product_id);
CREATE INDEX IF NOT EXISTS idx_market_favorites_user ON market_favorites(tg_user_id);

-- 2. Follows (follow a shop)
CREATE TABLE IF NOT EXISTS market_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_user_id TEXT NOT NULL,
  business_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_follows_unique ON market_follows(tg_user_id, business_id);
CREATE INDEX IF NOT EXISTS idx_market_follows_user ON market_follows(tg_user_id);
CREATE INDEX IF NOT EXISTS idx_market_follows_biz ON market_follows(business_id);

-- 3. Widen market_events.event_type CHECK (inline constraint was auto-named
--    market_events_event_type_check by Postgres)
ALTER TABLE market_events DROP CONSTRAINT IF EXISTS market_events_event_type_check;
ALTER TABLE market_events ADD CONSTRAINT market_events_event_type_check
  CHECK (event_type IN ('view_market','view_product','click_chat',
                        'favorite','unfavorite','share','follow','unfollow',
                        'view_shop','write_review'));

-- 4. Per-business, time-windowed reads (owner search-insights dashboard)
CREATE INDEX IF NOT EXISTS idx_market_events_biz_created
  ON market_events(business_id, created_at DESC) WHERE business_id IS NOT NULL;
