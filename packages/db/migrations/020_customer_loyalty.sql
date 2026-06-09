-- Migration 020: Customer loyalty points system
-- Adds loyalty_points + phone (if not present) to customers table.
-- No changes to existing rows needed — defaults handle them.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for loyalty leaderboard queries
CREATE INDEX IF NOT EXISTS idx_customers_loyalty
  ON customers(business_id, loyalty_points DESC);

COMMENT ON COLUMN customers.loyalty_points IS
  '10 pts per order, +5 pts for first order, +20 pts for >500 ETB order';
