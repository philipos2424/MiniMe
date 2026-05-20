-- MiniMe Search — waitlist for zero-result searches
-- When a user searches and finds nothing, we store their query
-- and notify them via @minimesearchbot when a matching business joins.

CREATE TABLE IF NOT EXISTS search_waitlist (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  searcher_telegram_id TEXT NOT NULL,
  raw_query            TEXT NOT NULL,
  parsed_category      TEXT,
  keywords             TEXT[] DEFAULT '{}',
  notified_at          TIMESTAMPTZ,        -- null = waiting, set when notified
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_waitlist_category
  ON search_waitlist(parsed_category) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_search_waitlist_searcher
  ON search_waitlist(searcher_telegram_id) WHERE notified_at IS NULL;
