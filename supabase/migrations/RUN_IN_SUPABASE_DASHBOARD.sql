-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in Supabase Dashboard → SQL Editor
-- https://supabase.com/dashboard/project/hbmesjhkczhqpbdseifd/sql
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Concurrency safety: unique indexes to prevent duplicate customers/conversations
-- under concurrent webhook load.

-- De-duplicate first (keep oldest row)
WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY business_id, telegram_id ORDER BY created_at ASC) AS rn
  FROM customers WHERE telegram_id IS NOT NULL
)
DELETE FROM customers WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY business_id, customer_id ORDER BY created_at ASC) AS rn
  FROM conversations WHERE customer_id IS NOT NULL
)
DELETE FROM conversations WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS customers_business_telegram_unq
  ON customers (business_id, telegram_id) WHERE telegram_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_business_customer_unq
  ON conversations (business_id, customer_id) WHERE customer_id IS NOT NULL;

-- 2. Webhook idempotency table — prevents duplicate processing on Telegram retries.
CREATE TABLE IF NOT EXISTS webhook_dedupe (
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  update_id    bigint NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, update_id)
);
CREATE INDEX IF NOT EXISTS webhook_dedupe_processed_idx ON webhook_dedupe (processed_at);

-- 3. Audit log table — immutable record for SOC 2 / GDPR compliance.
CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid REFERENCES businesses(id) ON DELETE SET NULL,
  actor_type    text NOT NULL CHECK (actor_type IN ('owner','staff','platform_admin','system','customer')),
  actor_id      text NOT NULL,
  action        text NOT NULL,
  resource_type text,
  resource_id   text,
  metadata      jsonb,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_business_idx ON audit_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx    ON audit_logs (actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx   ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs (resource_type, resource_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. Broadcast opt-out column for customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS broadcast_opted_out boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS customers_opted_out_idx ON customers (business_id, broadcast_opted_out);
