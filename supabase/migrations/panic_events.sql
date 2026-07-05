-- Audit trail for panic_mode toggles. Today businesses.panic_mode is just a
-- boolean + one timestamp — no history of who triggered it, why, or when it
-- was resolved. This table logs every on/off transition.
CREATE TABLE IF NOT EXISTS panic_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  trigger_reason TEXT NOT NULL CHECK (trigger_reason IN ('owner_request', 'error_rate', 'admin_action')),
  activated BOOLEAN NOT NULL, -- true = turned on, false = turned off (resolved)
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'platform_admin', 'system')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_panic_events_biz ON panic_events(business_id, created_at DESC);
