-- Canonical category for search/browse, alongside the freeform `category`.
--
-- `businesses.category` is owner- and LLM-authored free text: 150+ distinct
-- values across 385 listable shops ("electronics retail", "mobile phone
-- retail", "pigeon breeding"). Search treated it as an enum and hard-filtered
-- on it, so a query for "laptop" (→ electronics_phones) deleted the shop
-- holding seven real laptops because it was filed under "electronics retail".
--
-- This column holds the normalized id ONLY. `category` keeps the owner's own
-- wording for display — we are not overwriting what shops wrote about
-- themselves. NULL means "makes no canonical claim" (generic values like
-- "retail"/"services"/"other" normalize to NULL) and is treated as eligible
-- for every category, never as a mismatch.
--
-- The mapping lives in apps/web/src/lib/server/categoryMap.mjs and is applied
-- at write time; run scripts/backfill-category-canonical.mjs to populate
-- existing rows through that same normalizer (one source of truth — do not
-- re-implement the mapping in SQL).
alter table businesses add column if not exists category_canonical text;

-- Browse-by-category and the search base pool filter on this directly.
create index if not exists businesses_category_canonical_idx
  on businesses (category_canonical)
  where category_canonical is not null;
