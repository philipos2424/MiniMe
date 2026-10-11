-- Dimts (call notes app) link, 8 October 2026. Additive and safe to run twice.
-- When an owner promises on a phone call "I'll send it on Telegram", Dimts asks
-- MiniMe to send it. Telegram bots cannot message a phone number cold, so a
-- message for a caller who has never chatted with the business waits here
-- until they share their number with the bot.

CREATE TABLE IF NOT EXISTS dimts_links (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  dimts_user_id TEXT NOT NULL UNIQUE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dimts_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  dimts_send_id TEXT NOT NULL UNIQUE,          -- idempotency key from Dimts
  phone TEXT NOT NULL,                          -- caller, E.164 as Dimts saw it
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'sent', 'failed')),
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dimts_deliveries_waiting_idx
  ON dimts_deliveries (business_id, created_at) WHERE status = 'waiting';

-- Server-only tables: service role bypasses RLS; anon/authenticated get nothing.
ALTER TABLE dimts_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE dimts_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dimts_links, dimts_deliveries FROM anon, authenticated;
