-- Migration 015: Add plan_tier, payment_ref, payment_notes to businesses
-- plan_tier is the canonical plan column used by the admin UI and replyEngine.
-- It was added directly to production but was never committed to a migration.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS plan_tier         VARCHAR(20)  DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS payment_ref       TEXT,
  ADD COLUMN IF NOT EXISTS payment_notes     TEXT;

-- Back-fill plan_tier from subscription_plan for existing rows
UPDATE businesses
SET plan_tier = subscription_plan
WHERE plan_tier IS NULL OR plan_tier = 'free' AND subscription_plan IS NOT NULL AND subscription_plan <> 'free';

-- Index for payment callback lookup
CREATE INDEX IF NOT EXISTS businesses_payment_ref_idx ON businesses(payment_ref)
  WHERE payment_ref IS NOT NULL;
