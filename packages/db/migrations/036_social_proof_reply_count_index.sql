-- Migration 036: make the social-proof reply count cheap
--
-- The paywall shows "MiniMe has written N replies for them", which is
--   SELECT count(*) FROM messages WHERE is_ai_generated AND direction='outbound'
--
-- `messages` is the largest table in the system and nothing indexed that
-- predicate, so the count was a full sequential scan — sitting on the render
-- path of every upgrade screen. Existing indexes on messages are all
-- business_id/conversation_id-leading and can't serve a global count.
--
-- A partial index over just the matching rows lets Postgres answer with an
-- index-only scan. It also stays small: it holds only MiniMe's outbound AI
-- replies, not the whole table.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RUN THIS OUTSIDE A TRANSACTION.
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction block. In the
--   Supabase SQL editor, run this file on its own. Without CONCURRENTLY the
--   build takes an ACCESS EXCLUSIVE lock and blocks every write to `messages`
--   for the duration — i.e. customer replies stop being recorded while it runs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_ai_outbound
  ON messages (id)
  WHERE is_ai_generated = true AND direction = 'outbound';

COMMENT ON INDEX idx_messages_ai_outbound IS
  'Partial index serving the social-proof reply count (lib/server/socialProof.js). Keep the predicate in sync with that query.';
