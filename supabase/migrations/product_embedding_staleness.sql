-- Products are written from many places — owner-command flows (ownerCommands.js,
-- teaching.js), channel-post auto-import, AND directly from the browser via
-- the Supabase client (ProductsPage.jsx, RLS-scoped, no server route at all).
-- A JS-level "re-embed on product change" hook can only ever cover the paths
-- someone remembers to wire it into — it silently misses client writes (which
-- can't call OpenAI anyway) and any future code path.
--
-- Fix at the database level instead: any insert/update/delete on a business's
-- products marks their search_embedding stale (NULL). The existing backfill
-- (cron, now 100/batch daily, or the admin "Sync embeddings now" button) picks
-- it back up and regenerates it with the current catalog — this is the actual
-- fix for "searchable but embedding reflects an empty/stale profile."
-- Only the fields that actually feed the embedding text (see
-- embeddingBackfill.js: name, name_am, description, price, currency,
-- is_active) trigger a re-embed — NOT stock_quantity, which changes on
-- every single order and would otherwise keep every active store's
-- embedding permanently stale.
CREATE OR REPLACE FUNCTION mark_business_embedding_stale()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.name_am IS NOT DISTINCT FROM OLD.name_am
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
  THEN
    RETURN NEW; -- e.g. a stock_quantity change — not embedding-relevant
  END IF;

  UPDATE businesses
  SET search_embedding = NULL
  WHERE id = COALESCE(NEW.business_id, OLD.business_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_embedding_stale ON products;
CREATE TRIGGER trg_product_embedding_stale
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION mark_business_embedding_stale();
