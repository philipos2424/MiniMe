-- Private onboarding state must not travel with businesses.select('*'), which
-- is used by customer-facing APIs and AI context builders.
CREATE TABLE IF NOT EXISTS business_onboarding (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  country_code varchar(2),
  owner_contact_email varchar(254),
  owner_contact_phone varchar(32),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE business_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON business_onboarding FROM anon, authenticated;
GRANT ALL ON business_onboarding TO service_role;
COMMENT ON TABLE business_onboarding IS 'Owner-only onboarding drafts and private contact information. Never include in customer prompts or public APIs.';

-- Preview/correction requests may run in different serverless processes.
CREATE TABLE IF NOT EXISTS onboarding_reply_previews (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  owner_telegram_id bigint NOT NULL,
  question text NOT NULL,
  draft text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS onboarding_reply_previews_expiry ON onboarding_reply_previews(expires_at);
ALTER TABLE onboarding_reply_previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onboarding_reply_previews FROM anon, authenticated;
GRANT ALL ON onboarding_reply_previews TO service_role;
