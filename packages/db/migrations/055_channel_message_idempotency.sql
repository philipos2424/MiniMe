-- 055: make webhook delivery deduplication race-safe.
--
-- The shared channel pipeline checks external_id before inserting, but webhook
-- retries can pass that check concurrently. This constraint makes the insert
-- itself authoritative while allowing the same provider message ID to exist
-- for different businesses or platforms.

CREATE UNIQUE INDEX IF NOT EXISTS messages_business_platform_external_unique
  ON messages (business_id, platform, external_id)
  WHERE external_id IS NOT NULL;
