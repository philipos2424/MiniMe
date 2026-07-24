-- Self-reported acquisition attribution: "How did you hear about us?"
-- Captured (optionally) at signup. Distinct from `referred_by`, which is the
-- peer-invite link mechanism — this is the marketing channel the owner names.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS acquisition_source TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_source_detail TEXT;

-- Index for the admin channel-attribution breakdown.
CREATE INDEX IF NOT EXISTS idx_businesses_acquisition_source
  ON businesses(acquisition_source) WHERE acquisition_source IS NOT NULL;
