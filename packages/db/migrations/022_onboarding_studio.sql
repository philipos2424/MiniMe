
-- 1. Add onboarding_token and scribe_state to businesses table
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS onboarding_token TEXT,
ADD COLUMN IF NOT EXISTS scribe_state JSONB DEFAULT '{"captured": [], "missing": ["business_name", "category", "voice_profile", "price_list"]}';

-- 2. Create the onboarding_ingestion table for the Telegram -> Web bridge
CREATE TABLE IF NOT EXISTS onboarding_ingestion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL, -- 'text', 'image', 'document'
  raw_data TEXT,
  storage_url TEXT,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast retrieval during onboarding
CREATE INDEX IF NOT EXISTS idx_onboarding_ingestion_business ON onboarding_ingestion(business_id);
