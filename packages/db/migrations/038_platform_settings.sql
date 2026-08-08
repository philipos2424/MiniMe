-- Migration 038: editable platform settings
--
-- Where MiniMe's own money goes (Telebirr number, bank account) and what the
-- receipt says lived only in Vercel env vars. That made them un-editable by the
-- person who actually owns the accounts, and they sat unset — so owners were
-- shown placeholder details and told to pay a non-existent account.
--
-- Key/value rather than columns so a new rail or receipt field doesn't need a
-- migration. Secrets (gateway API keys) are stored encrypted with the same
-- AES-256-GCM helper used for bot tokens; display values stay plaintext because
-- they're printed on the payment screen anyway.
CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  encrypted   BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT
);

COMMENT ON TABLE platform_settings IS
  'Runtime platform config edited from /admin/settings. Service-role only — never expose to anon.';

-- This table holds encrypted gateway credentials. RLS on with NO policies means
-- the anon/authenticated PostgREST roles can read nothing; the service-role key
-- used by the server bypasses RLS. Without this the table would be world-
-- readable through the public Supabase URL.
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform_settings_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_settings_touch ON platform_settings;
CREATE TRIGGER trg_platform_settings_touch
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION platform_settings_touch();
