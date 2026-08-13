-- MiniMe Market — image-aware product search.
-- Run in Supabase SQL Editor.
--
-- Product photos were stored but never analyzed: search only ever matched
-- name/description/name_am/description_am, so a bare product photo with no
-- descriptive text (most of the catalog) was invisible to a query like
-- "red dress" even when the photo obviously shows one. This adds a short,
-- vision-derived tag string that rides the exact same text-matching and
-- embedding machinery `description` already uses — no new query shape.

-- 1. Tag column: a short plain string, e.g. "red, dress, cotton, casual wear"
--    — not an array, so it slots directly into the existing ilike/wordMatch/
--    embedding-text code paths that already operate on `description`.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_tags TEXT;

-- 2. Staleness: a re-tag (photo replaced, or the backfill catching up) must
--    queue a re-embed the same way a name/description edit already does.
--    Same NULL-means-stale convention as product_search_embeddings.sql —
--    extending that trigger here rather than adding a second one.
CREATE OR REPLACE FUNCTION mark_product_embedding_stale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.name_am IS DISTINCT FROM OLD.name_am
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.image_tags IS DISTINCT FROM OLD.image_tags
  THEN
    NEW.search_embedding := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Trigger itself (trg_product_self_embedding_stale) already points at this
-- function — CREATE OR REPLACE above is sufficient, no need to redefine it.
