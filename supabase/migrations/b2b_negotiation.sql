-- B2B Negotiation columns
-- Adds negotiation state tracking to business_messages and auto-negotiate flag to businesses

ALTER TABLE business_messages ADD COLUMN IF NOT EXISTS thread_status text DEFAULT 'open'
  CHECK (thread_status IN ('open','negotiating','agreed','declined','expired'));

ALTER TABLE business_messages ADD COLUMN IF NOT EXISTS offer_data jsonb DEFAULT '{}'::jsonb;
-- Structured offer: { product, qty, unit, price_per_unit, total, currency, delivery, payment_terms, type }

ALTER TABLE business_messages ADD COLUMN IF NOT EXISTS negotiation_round integer DEFAULT 0;

-- Per-business: allow the AI to auto-negotiate on their behalf (off by default)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS b2b_auto_negotiate boolean DEFAULT false;
-- Optional owner negotiation limits stored as JSON in notification_prefs.b2b_limits:
-- { min_sell_price, max_discount_pct, max_qty_sell, max_budget_buy, auto_accept_below, auto_decline_above }

NOTIFY pgrst, 'reload schema';
