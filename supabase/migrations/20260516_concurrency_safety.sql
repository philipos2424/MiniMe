-- Concurrency safety: unique constraints to prevent duplicate customer/conversation
-- rows when two webhooks for the same customer arrive simultaneously.

-- First de-duplicate any existing duplicates (keep the oldest row, delete the rest).
-- This is safe because we cascade dependencies via FKs.
WITH dupes AS (
  SELECT id, business_id, telegram_id,
         ROW_NUMBER() OVER (PARTITION BY business_id, telegram_id ORDER BY created_at ASC) AS rn
  FROM customers
  WHERE telegram_id IS NOT NULL
)
DELETE FROM customers WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

WITH dupes AS (
  SELECT id, business_id, customer_id,
         ROW_NUMBER() OVER (PARTITION BY business_id, customer_id ORDER BY created_at ASC) AS rn
  FROM conversations
  WHERE customer_id IS NOT NULL
)
DELETE FROM conversations WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- Unique constraints (partial so we don't conflict on NULL telegram_id for non-Telegram customers)
CREATE UNIQUE INDEX IF NOT EXISTS customers_business_telegram_unq
  ON customers (business_id, telegram_id)
  WHERE telegram_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_business_customer_unq
  ON conversations (business_id, customer_id)
  WHERE customer_id IS NOT NULL;

-- Webhook idempotency table — dedupe by (business_id, update_id) to prevent
-- duplicate processing on Telegram retries.
CREATE TABLE IF NOT EXISTS webhook_dedupe (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  update_id   bigint NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, update_id)
);
CREATE INDEX IF NOT EXISTS webhook_dedupe_processed_idx ON webhook_dedupe (processed_at);

-- The dedup table is auto-cleaned by the data-retention cron (drops rows >24h old).
-- For now, document the cleanup query:
-- DELETE FROM webhook_dedupe WHERE processed_at < now() - interval '24 hours';
