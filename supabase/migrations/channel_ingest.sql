-- ═══════════════════════════════════════════════════════════════════════════
-- Channel ingestion: MiniMe watches the owner's Telegram channel. When the bot
-- is an admin of the channel, each new product post is read, extracted with
-- Claude, and saved to `products`. These columns link a channel to a business
-- and let us ignore posts from channels we don't monitor.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS source_channel_id       text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS source_channel_username text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS source_channel_title    text;

-- Look up the business that owns an incoming channel_post (platform-bot path,
-- where the webhook secret doesn't already identify the tenant).
CREATE INDEX IF NOT EXISTS businesses_source_channel_idx
  ON businesses (source_channel_id)
  WHERE source_channel_id IS NOT NULL;

-- Album (media group) reply de-dupe. A multi-photo channel post arrives as
-- several `channel_post` updates sharing one media_group_id, each a separate
-- serverless invocation. The first to insert its media_group_id here becomes
-- the "leader" that sends the single owner confirmation; siblings still ingest
-- their own photo but stay quiet.
CREATE TABLE IF NOT EXISTS channel_import_groups (
  media_group_id text PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Housekeeping: these rows are only useful for the few seconds an album spans.
CREATE INDEX IF NOT EXISTS channel_import_groups_created_idx
  ON channel_import_groups (created_at);

ALTER TABLE channel_import_groups ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
