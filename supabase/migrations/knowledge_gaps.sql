-- Knowledge gaps: real-time log of customer questions MiniMe could not
-- answer because the owner never taught it. Today that moment is entirely
-- prompt-instructed ("say you'll check with the owner") with no persistent
-- record — this table gives it one, and powers:
--   - the live "ask the owner" Telegram handoff (notifyOwnerKnowledgeGap)
--   - a "Needs you / Teach" queue in the app
--   - real (not guessed) evidence for the weekly selfImprove.js mining
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  answer TEXT,
  source TEXT NOT NULL DEFAULT 'reply_engine', -- reply_engine | brain_mode | self_improve
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_business_open
  ON knowledge_gaps(business_id, created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_conversation
  ON knowledge_gaps(conversation_id) WHERE conversation_id IS NOT NULL;
