-- Business logo/cover image for directory listings and search results
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Index for quickly finding businesses with images (for directory highlights)
CREATE INDEX IF NOT EXISTS idx_businesses_has_logo
  ON businesses(id) WHERE logo_url IS NOT NULL;
