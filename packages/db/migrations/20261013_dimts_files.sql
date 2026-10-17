-- Additive: legacy /api/dimts/send and its delivery ledger remain compatible.
CREATE TABLE IF NOT EXISTS dimts_file_deliveries (
  send_id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending','sent','failed','unknown')),
  message_id BIGINT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dimts_file_deliveries_business ON dimts_file_deliveries(business_id);
ALTER TABLE dimts_file_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dimts_file_deliveries FROM anon, authenticated;
