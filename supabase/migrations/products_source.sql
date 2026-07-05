-- Tags where a product came from (channel import/monitor vs manual entry etc.)
-- so Settings → Product channel can show a "recently imported" list.
-- NULL = pre-existing/manual products; untouched by this migration.
ALTER TABLE products ADD COLUMN IF NOT EXISTS source VARCHAR(20);

CREATE INDEX IF NOT EXISTS products_business_source_idx
  ON products (business_id, source, created_at DESC);
