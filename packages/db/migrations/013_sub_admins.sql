-- Migration 013: Sub-admin Telegram IDs per business
-- Allows business owners to designate additional Telegram accounts that can
-- access the MiniMe app (teach, conversations, advisor) for their business.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS sub_admin_telegram_ids BIGINT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS businesses_sub_admin_ids_gin
  ON businesses USING gin(sub_admin_telegram_ids);
