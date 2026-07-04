-- MiniMe Search — directory backfill: onboard all connected + shared bots
-- Run in Supabase SQL Editor.
--
-- Legacy businesses signed up before search existed have b2b_discoverable = NULL
-- (invisible in the directory) and shared-mode businesses were excluded from the
-- semantic RPC entirely. This migration:
--   1. Flips b2b_discoverable → true for every onboarded business that never
--      touched the setting (NULL only — explicit opt-outs stay false).
--   2. Generates a shop_code for onboarded businesses missing one, so shared-mode
--      shops have a working t.me/MiniMeAgentBot?start=shop_XXX deep link.
--   3. Replaces match_businesses_by_search so semantic search includes shared
--      shops and returns the same shape as searchDirectory's select (searchBot.js)
--      — formatResults/contactUrlFor need shop_code, tagline, logo_url, ratings.
--
-- After running: loop GET /api/cron/backfill-embeddings (Bearer CRON_SECRET)
-- until it reports processed: 0, so newly discoverable rows get embeddings.

-- 1. Discoverability backfill (conservative: NULL only)
UPDATE businesses
SET b2b_discoverable = true
WHERE onboarding_completed = true
  AND b2b_discoverable IS NULL;

-- 2. Shop-code backfill (same md5 derivation as shared_bot_mode.sql's backfill;
--    shop_code is UNIQUE — md5 over id+now makes collisions negligible)
UPDATE businesses
SET shop_code = lower(substr(md5(id::text || now()::text), 1, 8))
WHERE onboarding_completed = true
  AND shop_code IS NULL;

-- 2b. Verified-business badge (admin-granted; shown as ✅ in search results,
--     verified businesses rank first in the directory)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- 3. Semantic RPC: include shared shops, return searchDirectory's column shape
DROP FUNCTION IF EXISTS match_businesses_by_search(vector(1536), float, int);
CREATE OR REPLACE FUNCTION match_businesses_by_search(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  tagline TEXT,
  category TEXT,
  tags TEXT[],
  location TEXT,
  address TEXT,
  telegram_bot_username TEXT,
  shop_code VARCHAR(20),
  search_count INT,
  logo_url TEXT,
  average_rating NUMERIC(2,1),
  total_reviews INT,
  verified BOOLEAN,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT
    b.id, b.name, b.description, b.tagline, b.category, b.tags,
    b.location, b.address, b.telegram_bot_username, b.shop_code,
    b.search_count, b.logo_url, b.average_rating, b.total_reviews,
    b.verified,
    1 - (b.search_embedding <=> query_embedding) AS similarity
  FROM businesses b
  WHERE b.b2b_discoverable = true
    AND (
      b.telegram_bot_username IS NOT NULL
      OR (b.shop_code IS NOT NULL AND b.onboarding_completed = true)
    )
    AND b.search_embedding IS NOT NULL
    AND 1 - (b.search_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
