-- Backup vault for account deletion.
--
-- When an owner deletes their account, POST /api/businesses/delete anonymizes
-- the live business row and purges child data. Before that purge runs, we snapshot
-- the business row plus its core child tables into `snapshot` here, keyed by the
-- owner's Telegram id. If the same owner re-opens MiniMe within `expires_at`, the
-- restore flow re-hydrates their shop from this row.
--
-- Media files in Supabase Storage are still swept per the privacy policy — this
-- vault restores DB records only.
CREATE TABLE IF NOT EXISTS deleted_business_backups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL,
  owner_telegram_id  bigint NOT NULL,
  original_name      text,
  snapshot           jsonb NOT NULL,
  deleted_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

-- Fast lookup on return: "does this owner have a restorable backup?"
CREATE INDEX IF NOT EXISTS deleted_business_backups_owner_idx
  ON deleted_business_backups (owner_telegram_id, expires_at DESC);
