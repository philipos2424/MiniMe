-- 036_lead_cards_voice_mirror.sql — Agentic Transparency & Voice Mirror tables
-- Adds Lead Cards for approval gateway and Voice Mirror for style learning.

-- 1. LEAD CARDS
-- Stores proposed outbound messages that require owner approval before sending.
CREATE TABLE lead_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  -- The "Who" - target entity
  target_name VARCHAR(255),
  target_type VARCHAR(20) DEFAULT 'customer' CHECK (target_type IN ('customer', 'supplier', 'b2b_lead', 'b2b_qualified')),
  target_telegram_id BIGINT,
  target_external_id VARCHAR(255),
  -- The "Why" - synergy/analysis from AI
  analysis TEXT,
  -- The "Proposed Draft" - what the bot wants to send
  proposed_draft TEXT NOT NULL,
  -- Context
  trust_level INTEGER CHECK (trust_level BETWEEN 0 AND 3),
  confidence FLOAT,
  intent VARCHAR(50),
  -- Status tracking
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'edited', 'expired')),
  owner_response TEXT, -- 'YES', edited text, or rejection reason
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. VOICE MIRROR
-- Stores draft vs correction pairs to learn the owner's communication style.
CREATE TABLE voice_mirror (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  draft_text TEXT NOT NULL,
  corrected_text TEXT NOT NULL,
  edit_distance INTEGER DEFAULT 0,
  message_type VARCHAR(20) DEFAULT 'reply' CHECK (message_type IN ('reply', 'b2b_negotiation', 'supplier', 'customer_followup')),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INDEXES
CREATE INDEX idx_lead_cards_business ON lead_cards(business_id, created_at DESC);
CREATE INDEX idx_lead_cards_status ON lead_cards(business_id, status);
CREATE INDEX idx_lead_cards_conversation ON lead_cards(conversation_id);
CREATE INDEX idx_voice_mirror_business ON voice_mirror(business_id, created_at DESC);

-- 4. ROW LEVEL SECURITY
ALTER TABLE lead_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_mirror ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON lead_cards FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON voice_mirror FOR ALL USING (true) WITH CHECK (true);

-- 5. TRIGGERS
CREATE TRIGGER lead_cards_updated_at BEFORE UPDATE ON lead_cards FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER voice_mirror_updated_at BEFORE UPDATE ON voice_mirror FOR EACH ROW EXECUTE FUNCTION update_updated_at();