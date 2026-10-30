-- Migration 064: orders.meta for payment follow-ups
--
-- The "I've paid" flow writes orders.meta.payment_claimed_at, and
-- cron/payment-followups reads it to remind an owner who hasn't confirmed.
-- The column was never created, so:
--   - the claim stamp failed silently on every "I've paid" tap;
--   - the reminder query errored, so no owner was ever reminded;
--   - "Not yet" selected meta too, got no row back, and the customer was
--     never told the payment wasn't seen.
-- This also holds the new unpaid-order reminder stamps
-- (customer_nudged_at, owner_nudged_at).
--
-- Additive and safe to run before or after the code.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The follow-up cron scans unpaid orders a few times a day.
CREATE INDEX IF NOT EXISTS idx_orders_pending_payment_created
  ON orders (created_at)
  WHERE status = 'pending_payment';
