-- Migration: discounts table + customer birthday columns
-- Run this in the Supabase SQL editor or via `supabase db push`

-- ─── 1. Discounts table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discounts (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid          NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code          text          NOT NULL,
  type          text          NOT NULL DEFAULT 'percent' CHECK (type IN ('percent', 'fixed')),
  value         numeric       NOT NULL CHECK (value > 0),
  min_order     numeric,
  max_uses      integer,
  used_count    integer       NOT NULL DEFAULT 0,
  expires_at    timestamptz,
  is_active     boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (business_id, code)
);

-- Index for fast lookup by business + active state
CREATE INDEX IF NOT EXISTS discounts_business_active_idx ON discounts (business_id, is_active);

-- Enable RLS (service-role key bypasses, Next.js uses service role)
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;

-- Policy: business owner can read/write their discounts
-- (in practice the Next.js server uses service key so RLS is advisory)
CREATE POLICY "owner can manage discounts" ON discounts
  FOR ALL
  USING (business_id IN (
    SELECT id FROM businesses WHERE owner_telegram_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint
  ));

-- ─── 2. Customer birthday + special_dates columns ─────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS birthday      date,
  ADD COLUMN IF NOT EXISTS special_dates jsonb;

-- Index for birthday cron (fast per-month-day lookup)
CREATE INDEX IF NOT EXISTS customers_birthday_mmdd_idx
  ON customers (to_char(birthday, 'MM-DD'))
  WHERE birthday IS NOT NULL;

-- ─── 3. Orders refund columns (graceful — no-op if already exist) ─────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refunded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reason text;
