-- Migration 012: feedback table
-- Captures owner thumbs-up / thumbs-down on agent actions, advisor replies, and low-confidence drafts.

CREATE TABLE IF NOT EXISTS feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('agent_action','advisor_reply','failed_attempt','low_confidence_draft')),
  target_id    UUID,         -- references agent_runs.id, messages.id, or advisor_messages.id depending on source
  helpful      BOOLEAN NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_business_idx ON feedback(business_id, created_at DESC);

-- RLS: service role full access (browser anon stays out, all writes go through server-side routes)
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON feedback;
CREATE POLICY "Service role full access" ON feedback USING (true);
