-- 027_conversation_intent.sql
-- Persist the per-message classification the reply engine already computes
-- (src/lib/server/intent.js → detectIntent) onto the conversation row, so the
-- owner inbox can group chats like a salesperson would ("Reply now", "Ready to
-- buy", "Needs your OK", "Handled") instead of one flat list.
--
-- Previously intent/urgency/sentiment were computed on every inbound message
-- and then thrown away. These columns hold the LATEST inbound classification.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_intent    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_urgency   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS last_sentiment VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_intent_at TIMESTAMPTZ;

-- Partial index for the "Reply now" / "Ready to buy" sections — only the small
-- set of conversations still needing the owner is ever filtered by urgency.
CREATE INDEX IF NOT EXISTS idx_conversations_urgency
  ON conversations (business_id, last_urgency)
  WHERE requires_owner = TRUE;
