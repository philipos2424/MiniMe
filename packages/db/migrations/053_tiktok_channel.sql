-- Migration 053: TikTok channel
--
-- Adds TikTok as a fifth conversation platform, alongside Telegram and the
-- three Meta channels from 019_omnichannel.sql.
--
-- Transport is the TikTok Business Messaging API (business-api.tiktok.com,
-- v1.3): a TikTok user DMs the shop's Business Account, TikTok delivers the
-- message to our webhook, and we reply through the same conversation.
-- See apps/web/src/lib/server/tiktokApi.js for the endpoint table.

-- ── conversations.platform ────────────────────────────────────────────────────
-- 019 pinned this to a 4-value CHECK. Drop whatever constraint currently
-- guards the column (the name is generated, so find it) and re-add with tiktok.
DO $$
DECLARE con_name TEXT;
BEGIN
  SELECT con.conname INTO con_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
   WHERE rel.relname = 'conversations'
     AND con.contype = 'c'
     AND att.attname = 'platform'
   LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_platform_check
  CHECK (platform IN ('telegram','whatsapp','instagram','facebook','tiktok'));

-- The channel's own thread identifier. Telegram and Meta address a reply by
-- recipient alone, but TikTok addresses it by conversation_id, so the thread
-- has to survive between the inbound webhook and the owner's later reply.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS external_thread_id TEXT;

-- ── customers ─────────────────────────────────────────────────────────────────
-- TikTok addresses a user by an app-scoped open_id, stable per business account.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS tiktok_id       TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_username TEXT;

CREATE INDEX IF NOT EXISTS customers_tiktok_idx
  ON customers(tiktok_id) WHERE tiktok_id IS NOT NULL;

-- One customer row per (business, TikTok user). Mirrors the guarantee the Meta
-- channels rely on and closes the double-insert race on concurrent webhooks.
CREATE UNIQUE INDEX IF NOT EXISTS customers_business_tiktok_unique
  ON customers(business_id, tiktok_id) WHERE tiktok_id IS NOT NULL;

-- ── businesses ────────────────────────────────────────────────────────────────
-- tiktok_business_id is the Business Account ID the webhook payload carries;
-- it is how an inbound event finds its business, so it must be unique.
--
-- Note the existing `businesses.tiktok` column (007_business_contacts) is a
-- different thing: the handle the owner typed for their public profile. These
-- columns describe the OAuth-connected messaging account, which is verified.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS tiktok_business_id        TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_username           TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_display_name       TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_access_token_enc   TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_refresh_token_enc  TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_token_expires_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tiktok_connected_at       TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS businesses_tiktok_business_id_unique
  ON businesses(tiktok_business_id) WHERE tiktok_business_id IS NOT NULL;
