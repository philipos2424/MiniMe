-- Migration 019: Omnichannel support
-- Adds platform tracking to conversations, customers, and messages.
-- Also adds Meta (WhatsApp/Instagram/Facebook) config fields to businesses.

-- Platform field on conversations
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS platform  VARCHAR(20) DEFAULT 'telegram'
    CHECK (platform IN ('telegram','whatsapp','instagram','facebook'));

-- Platform-specific external IDs on customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS platform     VARCHAR(20) DEFAULT 'telegram',
  ADD COLUMN IF NOT EXISTS whatsapp_id  TEXT,
  ADD COLUMN IF NOT EXISTS instagram_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_id  TEXT;

-- Platform on messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS platform    VARCHAR(20) DEFAULT 'telegram',
  ADD COLUMN IF NOT EXISTS external_id TEXT;  -- Meta message ID for dedup

-- Meta API config on businesses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id  TEXT,
  ADD COLUMN IF NOT EXISTS instagram_page_id         TEXT,
  ADD COLUMN IF NOT EXISTS facebook_page_id          TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token_enc     TEXT;  -- encrypted via existing crypto

-- Index for platform lookups
CREATE INDEX IF NOT EXISTS conversations_platform_idx ON conversations(business_id, platform);
CREATE INDEX IF NOT EXISTS customers_whatsapp_idx ON customers(whatsapp_id) WHERE whatsapp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_instagram_idx ON customers(instagram_id) WHERE instagram_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_facebook_idx ON customers(facebook_id) WHERE facebook_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_external_id_idx ON messages(external_id) WHERE external_id IS NOT NULL;
