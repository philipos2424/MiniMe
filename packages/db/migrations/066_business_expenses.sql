-- Migration 066: business costs, so "how much did I make?" has an answer
--
-- Owners can now tell MiniMe "paid 3,000 rent" or "bought stock 12,000".
-- profit_summary and the morning brief subtract these from sales. Only the
-- server (service role) reads or writes it, so RLS is on with no policies.
-- Additive; the code tells the owner expense tracking isn't ready if missing.
CREATE TABLE IF NOT EXISTS business_expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount      NUMERIC NOT NULL CHECK (amount > 0),
  currency    VARCHAR(8) NOT NULL DEFAULT 'ETB',
  category    TEXT NOT NULL DEFAULT 'other',
  note        TEXT,
  spent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_expenses_biz_spent_idx ON business_expenses (business_id, spent_at DESC);
ALTER TABLE business_expenses ENABLE ROW LEVEL SECURITY;

-- Credit sales are open orders with no deadline; the 24h default expiry is for bot checkouts.
CREATE INDEX IF NOT EXISTS orders_biz_credit_open_idx ON orders (business_id, created_at)
  WHERE status = 'pending_payment' AND payment_method = 'credit';
