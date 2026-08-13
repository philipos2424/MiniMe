-- 043_b2b_negotiations_fixes.sql
-- Completes the b2b_negotiations schema the bot B2B services rely on:
--   * b2b_negotiations_history table (negotiation_history.js writes here)
--   * final_price column on b2b_negotiations (negotiation_engine.js sets it)
--   * allow 'countered' in current_status (transaction_manager.js sets it)

-- 1. NEGOTIATION HISTORY
CREATE TABLE IF NOT EXISTS b2b_negotiations_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id UUID REFERENCES b2b_negotiations(id) ON DELETE CASCADE,
  sender_business_id UUID,
  message_content TEXT,
  offer_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_b2b_neg_history_negotiation ON b2b_negotiations_history(negotiation_id, created_at ASC);

-- 2. FINAL PRICE on the negotiation record
ALTER TABLE b2b_negotiations
  ADD COLUMN IF NOT EXISTS final_price DECIMAL(12,2);

-- 3. EXTEND current_status to include 'countered'
ALTER TABLE b2b_negotiations
  DROP CONSTRAINT IF EXISTS b2b_negotiations_current_status_check;

ALTER TABLE b2b_negotiations
  ADD CONSTRAINT b2b_negotiations_current_status_check
  CHECK (current_status IN ('negotiating', 'accepted', 'rejected', 'escalated', 'expired', 'countered'));