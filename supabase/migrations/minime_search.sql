-- MiniMe Search — directory analytics + search tracking
-- Run in Supabase SQL Editor

-- Add search analytics columns to businesses table
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS search_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_count  INT DEFAULT 0;

-- Index for sorting by popularity in search results
CREATE INDEX IF NOT EXISTS idx_businesses_search_count ON businesses(search_count DESC);

-- Search logs: what people searched for
CREATE TABLE IF NOT EXISTS search_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  searcher_telegram_id TEXT,
  raw_query           TEXT NOT NULL,
  parsed_intent       JSONB,
  results_count       INT DEFAULT 0,
  results_profile_ids UUID[],
  language            TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_logs_created   ON search_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_searcher  ON search_logs(searcher_telegram_id);

-- Search referrals: customers who landed on a business bot from search
CREATE TABLE IF NOT EXISTS search_referrals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_telegram_id TEXT,
  landed               BOOLEAN DEFAULT true,
  first_message_at     TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_referrals_business ON search_referrals(business_id);

-- RPC helper for atomic search_count increment (avoids race conditions)
CREATE OR REPLACE FUNCTION increment_search_count(business_ids UUID[])
RETURNS void LANGUAGE sql AS $$
  UPDATE businesses
  SET search_count = search_count + 1
  WHERE id = ANY(business_ids);
$$;

-- Make all existing businesses discoverable by default in search
UPDATE businesses SET search_count = 0 WHERE search_count IS NULL;
UPDATE businesses SET click_count  = 0 WHERE click_count  IS NULL;
