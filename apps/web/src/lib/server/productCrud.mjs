/**
 * Catalogue reads and writes — server side.
 *
 * ProductsPage ran all of these from the browser against the anon Supabase
 * client. 047_lock_down_anon_access.sql revoked every anon grant and left RLS
 * on with no policies, so PostgREST refused each one. The reads degraded to an
 * empty catalogue and — worse — the writes returned a rejected promise nobody
 * inspected, so adding a product, editing a price, adjusting stock and deleting
 * an item all appeared to work and silently changed nothing.
 *
 * Every function here takes a service-role client and a businessId resolved
 * from verified Telegram initData by the route. The businessId is never taken
 * from the request body: `pickEditableFields` strips `business_id` and `id`, and
 * every write filters on business_id as well as the row id, so a forged product
 * id belonging to another shop matches nothing.
 *
 * Kept free of any Supabase import so it can be unit-tested with a fake client.
 */

/** Archived items are a footnote in the UI, not a browsable list. */
export const ARCHIVED_LIMIT = 20;

/**
 * Columns a client is allowed to set. Deliberately excludes id, business_id,
 * created_at, updated_at, search_embedding and image_url — ownership and
 * identity are the server's to decide, the embedding is generated, and images
 * go through /api/products/:id/image which also handles storage.
 */
export const EDITABLE_FIELDS = [
  'name', 'name_am', 'description', 'description_am', 'category',
  'price', 'cost_price', 'currency', 'stock_quantity', 'low_stock_threshold',
  'bulk_discount_threshold', 'bulk_discount_percent', 'max_negotiable_discount',
  'is_active', 'source', 'image_tags',
];

/**
 * Narrow arbitrary client input to the editable whitelist.
 *
 * Explicit nulls are preserved: clearing a price or untracking stock is a real
 * edit, so this filters on key presence rather than on truthiness.
 */
export function pickEditableFields(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  }
  return out;
}

/** PostgREST returns a plain object, not an Error — rethrow a real one. */
function rethrow(error, what) {
  throw new Error(error.message || `${what} failed`, { cause: error });
}

/**
 * The full catalogue for one business: active items plus a capped tail of
 * archived ones.
 *
 * A failure throws. The catalogue IS the page, so a permission or transport
 * error must reach the owner as an error — degrading to `[]` is what let the
 * anon lockdown look like an empty shop.
 */
export async function listProducts(sb, { businessId }) {
  const [activeRes, archivedRes] = await Promise.all([
    sb.from('products').select('*')
      .eq('business_id', businessId).eq('is_active', true).order('name'),
    sb.from('products').select('*')
      .eq('business_id', businessId).eq('is_active', false).order('name').limit(ARCHIVED_LIMIT),
  ]);
  if (activeRes.error) rethrow(activeRes.error, 'product list query');
  if (archivedRes.error) rethrow(archivedRes.error, 'archived product query');
  return { products: activeRes.data || [], archived: archivedRes.data || [] };
}

/**
 * Add one item to the caller's catalogue.
 *
 * business_id is stamped from the verified caller after the whitelist has run,
 * so it cannot be overridden by the body.
 */
export async function createProduct(sb, { businessId, fields }) {
  const clean = pickEditableFields(fields);
  if (typeof clean.name !== 'string' || !clean.name.trim()) {
    throw new Error('name is required');
  }
  clean.name = clean.name.trim();
  // Untracked by default — the UI reads null stock as "Stock: Unlimited".
  if (!Object.prototype.hasOwnProperty.call(clean, 'stock_quantity')) clean.stock_quantity = null;
  if (!Object.prototype.hasOwnProperty.call(clean, 'is_active')) clean.is_active = true;

  const { data, error } = await sb.from('products')
    .insert({ ...clean, business_id: businessId })
    .select()
    .single();
  if (error) rethrow(error, 'product insert');
  return data;
}

/**
 * Edit one item.
 *
 * @returns { found } — false when the id does not exist OR belongs to another
 *          business. The two are deliberately indistinguishable to the caller,
 *          so this cannot be used to probe for other shops' product ids.
 */
export async function updateProduct(sb, { businessId, productId, fields }) {
  const clean = pickEditableFields(fields);
  if (!Object.keys(clean).length) throw new Error('no editable fields in request');
  if (typeof clean.name === 'string') {
    clean.name = clean.name.trim();
    if (!clean.name) throw new Error('name cannot be blank');
  }

  const { data, error } = await sb.from('products')
    .update(clean)
    .eq('id', productId)
    .eq('business_id', businessId)
    .select()
    .maybeSingle();
  if (error) rethrow(error, 'product update');
  return { found: !!data, product: data || null };
}

/** Remove one item, scoped so a foreign product id matches no row. */
export async function deleteProduct(sb, { businessId, productId }) {
  const { data, error } = await sb.from('products')
    .delete()
    .eq('id', productId)
    .eq('business_id', businessId)
    .select()
    .maybeSingle();
  if (error) rethrow(error, 'product delete');
  return { found: !!data };
}
