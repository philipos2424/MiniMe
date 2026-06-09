-- ============================================================
-- Multi-category support for businesses
-- Businesses can now appear in multiple search categories.
-- The existing 'category' column stays as the PRIMARY category.
-- The new 'categories' array is used for search (includes primary).
-- ============================================================

-- Add the array column
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT '{}';

-- Backfill: copy existing single category into the array
UPDATE businesses
SET categories = ARRAY[category]
WHERE category IS NOT NULL
  AND (categories IS NULL OR array_length(categories, 1) IS NULL OR array_length(categories, 1) = 0);

-- Index for fast array containment search
CREATE INDEX IF NOT EXISTS idx_businesses_categories
  ON businesses USING GIN(categories);
