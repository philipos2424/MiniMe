-- MiniMe Market — product-level semantic search.
-- Run in Supabase SQL Editor.
--
-- Search has been business-level only (businesses.search_embedding +
-- match_businesses_by_search): a query for a specific product variation had
-- no way to match on the product's own name/description, so the Market
-- catalog fell back to raw ilike or unrelated businesses. This adds a
-- per-product embedding + RPC the catalog route uses as a fallback when
-- ilike returns few hits.

-- 1. Per-product embedding column + HNSW index
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_products_search_embedding
  ON products USING hnsw (search_embedding vector_cosine_ops);

-- 2. RPC: match products by embedding similarity.
--    No businesses join here on purpose — the catalog route re-fetches the
--    matched ids through its own filtered query (discoverability, verified,
--    category, price), so a semantic hit can never bypass a filter the
--    customer actually chose.
CREATE OR REPLACE FUNCTION match_products_by_search(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 30
)
RETURNS TABLE (id UUID, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT p.id, 1 - (p.search_embedding <=> query_embedding) AS similarity
  FROM products p
  WHERE p.is_active = true
    AND p.search_embedding IS NOT NULL
    AND 1 - (p.search_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- 3. Staleness: NULL the embedding when the text that feeds it changes, so
--    the backfill regenerates it. Same NULL-means-stale convention as the
--    business embedding trigger (product_embedding_staleness.sql) — that
--    trigger stays as-is and continues to null the BUSINESS embedding; this
--    one only touches the product's own embedding.
CREATE OR REPLACE FUNCTION mark_product_embedding_stale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.name_am IS DISTINCT FROM OLD.name_am
     OR NEW.description IS DISTINCT FROM OLD.description
  THEN
    NEW.search_embedding := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_self_embedding_stale ON products;
CREATE TRIGGER trg_product_self_embedding_stale
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION mark_product_embedding_stale();
