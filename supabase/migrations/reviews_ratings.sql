-- ============================================================
-- MiniMe Search: Reviews & Ratings + Tagline + used_gpt tracking
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  reviewer_telegram_id TEXT NOT NULL,
  search_referral_id UUID,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  visible BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_business ON reviews(business_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer_telegram_id);

-- One review per customer per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique
  ON reviews(business_id, reviewer_telegram_id);

-- 2. Rating columns on businesses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS average_rating NUMERIC(2,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_reviews INT DEFAULT 0;

-- 3. Tagline column (max 50 chars, shown in search result cards)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS tagline TEXT;

-- 4. Track whether a search used GPT (for cache hit rate analytics)
ALTER TABLE search_logs
  ADD COLUMN IF NOT EXISTS used_gpt BOOLEAN DEFAULT false;

-- 5. Add search_log_id to search_referrals (links referral to specific search)
ALTER TABLE search_referrals
  ADD COLUMN IF NOT EXISTS search_log_id UUID;

-- 6. RPC: recalculate business rating from visible reviews
CREATE OR REPLACE FUNCTION update_business_rating(biz_id UUID)
RETURNS void LANGUAGE sql AS $$
  UPDATE businesses SET
    average_rating = COALESCE((
      SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews
      WHERE business_id = biz_id AND visible = true
    ), 0),
    total_reviews = COALESCE((
      SELECT COUNT(*) FROM reviews
      WHERE business_id = biz_id AND visible = true
    ), 0)
  WHERE id = biz_id;
$$;
