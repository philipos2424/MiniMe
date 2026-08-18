-- 045_reengagement_sends.sql
-- Attribution for the signup re-engagement engine.
--
-- Without this table we can send nudges but never learn which stage or which
-- copy variant actually brought anyone back, which makes copy iteration
-- guesswork. One row per DM sent.

CREATE TABLE IF NOT EXISTS reengagement_sends (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id  BIGINT NOT NULL,
  business_id  UUID,
  stage        TEXT NOT NULL,
  variant      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ DEFAULT now(),
  replied_at   TIMESTAMPTZ,
  exit_reason  TEXT,
  outcome      TEXT
);

CREATE INDEX IF NOT EXISTS idx_reengagement_sends_telegram
  ON reengagement_sends (telegram_id);

CREATE INDEX IF NOT EXISTS idx_reengagement_sends_sent
  ON reengagement_sends (sent_at DESC);

-- Outcome backfill scans unresolved sends; keep that scan cheap.
CREATE INDEX IF NOT EXISTS idx_reengagement_sends_unresolved
  ON reengagement_sends (sent_at) WHERE outcome IS NULL;
