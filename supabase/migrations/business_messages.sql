-- ═══════════════════════════════════════════════════════════════════════════
-- B2B Messaging: lets MiniMe businesses' bots talk to each other through
-- the MiniMe backend (Telegram itself blocks bot-to-bot direct messages).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS business_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     uuid NOT NULL,
  sender_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  recipient_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  initiated_by  bigint NOT NULL,
  intent        text NOT NULL CHECK (intent IN ('inquiry','order','coordination','chat','reply')),
  content       text NOT NULL,
  structured    jsonb DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','delivered','replied','declined','expired')),
  parent_id     uuid REFERENCES business_messages(id) ON DELETE SET NULL,
  ai_drafted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  replied_at    timestamptz
);

CREATE INDEX IF NOT EXISTS bm_recipient_idx ON business_messages (recipient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS bm_sender_idx    ON business_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bm_thread_idx    ON business_messages (thread_id, created_at);

ALTER TABLE business_messages ENABLE ROW LEVEL SECURITY;

-- B2B preferences on businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS b2b_blocklist bigint[] DEFAULT '{}';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS b2b_discoverable boolean DEFAULT true;
-- Pending B2B thread tracker for "Continue thread" multi-turn replies.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS b2b_pending_thread uuid;

NOTIFY pgrst, 'reload schema';
