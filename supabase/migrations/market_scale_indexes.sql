-- MiniMe Market — scale indexes + onboard every business into the directory.
-- Run in Supabase SQL Editor.

-- ── Scale: indexes behind the Market catalog / search / analytics hot paths ──

-- Market catalog: active products newest-first
CREATE INDEX IF NOT EXISTS idx_products_active_created
  ON products(created_at DESC) WHERE is_active = true;

-- Per-business active-product lookups (catalog join, top products, handoff)
CREATE INDEX IF NOT EXISTS idx_products_biz_active
  ON products(business_id) WHERE is_active = true;

-- Directory/search visibility filter
CREATE INDEX IF NOT EXISTS idx_businesses_discoverable
  ON businesses(b2b_discoverable) WHERE b2b_discoverable = true;

-- Per-searcher rollups (searcher traction table + "For you" profile)
CREATE INDEX IF NOT EXISTS idx_search_logs_searcher
  ON search_logs(searcher_telegram_id, created_at DESC);

-- ── Onboard EVERY business into search + Market ──────────────────────────────
-- Deliberate product decision: list everyone; the admin hides junk with the
-- new "Listed in Market & Search" toggle (or deletes it). The Market grid is
-- product-first, so businesses without products don't clutter it anyway.
UPDATE businesses SET b2b_discoverable = true
WHERE b2b_discoverable IS DISTINCT FROM true;

UPDATE businesses SET shop_code = lower(substr(md5(id::text || now()::text), 1, 8))
WHERE shop_code IS NULL;
