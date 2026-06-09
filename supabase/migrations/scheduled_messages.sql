-- ============================================================
-- Scheduled Messages
-- Allows owners to schedule messages to customers or segments.
-- The cron /api/cron/scheduled-messages runs every 15 minutes.
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,

  -- Who to send to
  target_type TEXT NOT NULL CHECK (target_type IN ('all', 'customer', 'segment', 'phone')),
  -- target_type = 'all'      → send to all customers
  -- target_type = 'segment'  → ordered, never_ordered, inactive_30d, gold, silver
  -- target_type = 'customer' → specific customer by telegram_id or id
  -- target_type = 'phone'    → phone number (for forwarding to non-customers)
  target_value TEXT,           -- segment name, customer telegram_id, or phone number

  -- Message content
  message TEXT NOT NULL,
  media_url TEXT,              -- optional image/file to attach

  -- Timing
  send_at TIMESTAMPTZ NOT NULL,
  timezone TEXT DEFAULT 'Africa/Addis_Ababa',

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  sent_at TIMESTAMPTZ,
  sent_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  error_message TEXT,

  -- Metadata
  created_by TEXT,             -- owner telegram_id who scheduled it
  label TEXT,                  -- optional label/description
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_business ON scheduled_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_send_at ON scheduled_messages(send_at)
  WHERE status = 'pending';
