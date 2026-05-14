-- Migration 016: Manual payment proof support
-- Adds payment verification + screenshot URL + payment method fields,
-- and a new 'pending_review' subscription status for high-value manual payments.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS payment_verified  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS payment_method    VARCHAR(20);

-- Widen subscription_status to allow 'pending_review'
ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_subscription_status_check;
ALTER TABLE businesses
  ADD CONSTRAINT businesses_subscription_status_check
  CHECK (subscription_status IN ('trial','active','expired','cancelled','pending_review'));
