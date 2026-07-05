-- search_referrals.search_log_id was referenced by application code
-- (searchBot.js / replyEngine.js referral inserts, api/admin/search-metrics)
-- but was never defined in any migration — per-query conversion tracking
-- has been silently degraded since it shipped. Adds the missing column.
ALTER TABLE search_referrals
  ADD COLUMN IF NOT EXISTS search_log_id UUID REFERENCES search_logs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_search_referrals_log
  ON search_referrals(search_log_id) WHERE search_log_id IS NOT NULL;
