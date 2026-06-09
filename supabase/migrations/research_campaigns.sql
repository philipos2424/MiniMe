-- ═══════════════════════════════════════════════════════════════════════════
-- Research Agent: owner says "find me the best X", bot contacts multiple
-- businesses, collects responses, and produces a comparison + recommendation.
-- Builds on top of B2B messaging (uses business_messages for the inquiries).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS research_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  owner_tg_id     bigint NOT NULL,
  query           text NOT NULL,
  category        text,
  questions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  budget          jsonb DEFAULT '{}'::jsonb,
  target_ids      uuid[] NOT NULL DEFAULT '{}',
  web_candidates  jsonb DEFAULT '[]'::jsonb,
  thread_ids      uuid[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','reporting','complete','cancelled')),
  reply_count     integer NOT NULL DEFAULT 0,
  interim_sent_at timestamptz,
  report          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS rc_business_idx ON research_campaigns (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rc_status_idx   ON research_campaigns (status, expires_at);
ALTER TABLE research_campaigns ENABLE ROW LEVEL SECURITY;

-- Tie B2B messages to a campaign when they're part of one
ALTER TABLE business_messages
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES research_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bm_campaign_idx ON business_messages (campaign_id) WHERE campaign_id IS NOT NULL;

-- Discovery columns on businesses (so we can search by category/tags)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
