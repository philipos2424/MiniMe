-- Audit logging table — immutable record of all destructive / sensitive actions.
-- Required for SOC 2 / GDPR / enterprise vendor questionnaires.

CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid REFERENCES businesses(id) ON DELETE SET NULL,
  actor_type    text NOT NULL CHECK (actor_type IN ('owner', 'staff', 'platform_admin', 'system', 'customer')),
  actor_id      text NOT NULL,
  action        text NOT NULL,
  resource_type text,
  resource_id   text,
  metadata      jsonb,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_business_idx  ON audit_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx     ON audit_logs (actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx    ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx  ON audit_logs (resource_type, resource_id);

-- Tamper resistance — disable UPDATE and DELETE except by service role.
-- (RLS is bypassed by service role, but this gives defense-in-depth.)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Read-only policy for authenticated users to see their own business's logs.
CREATE POLICY "owner reads own audit logs" ON audit_logs
  FOR SELECT
  USING (business_id IN (
    SELECT id FROM businesses WHERE owner_telegram_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint
  ));
