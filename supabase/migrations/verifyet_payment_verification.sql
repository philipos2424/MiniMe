-- Receipt verification via verify.et.
--
-- Until now "proof of payment" was a screenshot plus our own SUB-XXXXXX code
-- typed back to us, and monthly plans auto-activated on it. Nothing checked
-- that money moved, which is why 675 businesses read subscription_status
-- 'active' while payment_verified was true for exactly zero of them.
--
-- Two additions, both purely additive:
--   1. Columns on businesses to correlate an in-flight verification with the
--      payment that started it (verify.et answers asynchronously via webhook,
--      so the request id has to outlive the request).
--   2. payment_verifications — an append-only record of every verification
--      attempt and its verdict. Kept separate from businesses because the
--      interesting question is "show me everything that failed and why", which
--      a single overwritten column on the tenant row cannot answer.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS verifyet_request_id   TEXT,
  ADD COLUMN IF NOT EXISTS verifyet_expected_etb NUMERIC,
  ADD COLUMN IF NOT EXISTS verifyet_plan         TEXT,
  -- The BANK's transaction number off the merchant's receipt. Distinct from
  -- payment_ref, which is our own invoice code and means nothing to a bank.
  ADD COLUMN IF NOT EXISTS payment_bank_ref      TEXT;

-- Webhook lookups are by request id, so it needs to be findable and unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_verifyet_request
  ON businesses(verifyet_request_id) WHERE verifyet_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID REFERENCES businesses(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL DEFAULT 'verify.et',
  method          TEXT,                 -- telebirr | bank
  bank_reference  TEXT,                 -- the bank's transaction number
  our_reference   TEXT,                 -- our SUB-XXXXXX invoice code
  request_id      TEXT,                 -- verify.et requestId
  state           TEXT,                 -- verified | failed | pending | queued | error
  accepted        BOOLEAN NOT NULL DEFAULT FALSE,
  reason          TEXT,                 -- machine-readable verdict reason
  amount_etb      NUMERIC,              -- amount verify.et reported
  expected_etb    NUMERIC,              -- what the plan costs
  sender          TEXT,
  matched         BOOLEAN,              -- did it land in OUR account?
  match_confidence TEXT,
  source          TEXT,                 -- inline | webhook | poll | manual
  raw             JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_verifications_biz
  ON payment_verifications(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_verifications_failed
  ON payment_verifications(created_at DESC) WHERE accepted = FALSE;
CREATE INDEX IF NOT EXISTS idx_payment_verifications_bankref
  ON payment_verifications(bank_reference) WHERE bank_reference IS NOT NULL;

-- Service-role only, same as platform_settings: these rows carry payer names
-- and transaction references and must never be readable through the anon key.
ALTER TABLE payment_verifications ENABLE ROW LEVEL SECURITY;
