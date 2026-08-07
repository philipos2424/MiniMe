-- MiniMe Search — re-engagement nudge tracking for lapsed searchers.
-- Run in Supabase SQL Editor.
--
-- Tracks who's been sent a "come back and search" DM via @MiniMeSearchBot,
-- so the weekly cron doesn't re-nudge the same person and respects opt-outs
-- (reply STOP in the bot). Keyed by searcher_telegram_id only — no PII,
-- consistent with search_logs' pseudonymous tracking.

CREATE TABLE IF NOT EXISTS search_bot_nudges (
  searcher_telegram_id TEXT PRIMARY KEY,
  sent_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  opted_out BOOLEAN NOT NULL DEFAULT false,
  opted_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_bot_nudges_opted_out ON search_bot_nudges(opted_out) WHERE opted_out = false;
