/**
 * Availability — stock minus what other conversations have already claimed.
 *
 * products.stock_quantity is the only inventory number the catalog ever had,
 * and it does not move until Chapa confirms a payment. So two customers in two
 * separate chats were both told "yes, 1 left" for the same last unit, and both
 * could create an order for it.
 *
 * A "hold" here is simply an unpaid, unexpired order: status pending_payment
 * with expires_at in the future (orders default to a 24h window). Nothing new
 * is written to claim stock — the order IS the claim — so there is no second
 * source of truth to drift out of sync with, and releasing a hold is just the
 * order expiring or being cancelled.
 *
 * available = stock_quantity − held
 *
 * What the assistant may say about a hold is deliberately narrow: how many, and
 * nothing else. Never who holds it, when they ordered, or anything traceable to
 * another customer.
 *
 * The arithmetic and the prompt wording live in availabilityFormat.mjs so
 * node:test can import them — the Supabase import below is extensionless and
 * only the Next bundler resolves it.
 */
import { supabase } from './db';
import { annotateAvailability } from './availabilityFormat.mjs';

export {
  annotateAvailability, formatStock, formatStockCompact, holdsPromptBlock,
} from './availabilityFormat.mjs';

// Short by design. Holds change on order creation/payment/expiry, and each of
// those calls invalidateHoldCache — the TTL only bounds how stale a reply can
// be if an invalidation is missed or happens in another serverless instance.
const HOLD_CACHE_TTL = 30_000;
const _holdCache = new Map(); // businessId → { data, expiresAt }

/**
 * { product_id: heldQuantity } for a business, from unpaid unexpired orders.
 *
 * Returns {} on any failure — a missing RPC, a permissions error, a cold
 * database — so availability degrades to plain stock_quantity (today's
 * behaviour) rather than blocking replies.
 */
export async function getHeldQuantities(businessId) {
  if (!businessId) return {};
  const now = Date.now();
  const cached = _holdCache.get(businessId);
  if (cached && now < cached.expiresAt) return cached.data;

  let held = {};
  try {
    const { data, error } = await supabase().rpc('held_quantities', { p_business_id: businessId });
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      if (!row?.product_id) continue;
      held[row.product_id] = Number(row.held) || 0;
    }
  } catch (e) {
    console.warn('[availability] held_quantities unavailable — falling back to raw stock:', e.message);
    held = {};
  }
  _holdCache.set(businessId, { data: held, expiresAt: now + HOLD_CACHE_TTL });
  return held;
}

/** Call after any order is created, paid, cancelled or expired. */
export function invalidateHoldCache(businessId) {
  if (businessId) _holdCache.delete(businessId);
  else _holdCache.clear();
}

/**
 * This customer's own active holds, so their pending order doesn't count
 * against them when they add to it or re-confirm it.
 */
export async function getCustomerHolds(businessId, customerId) {
  if (!businessId || !customerId) return {};
  try {
    const { data } = await supabase()
      .from('orders')
      .select('items, expires_at')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .eq('status', 'pending_payment');
    const out = {};
    const now = Date.now();
    for (const o of data || []) {
      if (o.expires_at && Date.parse(o.expires_at) <= now) continue;
      for (const it of o.items || []) {
        if (!it?.product_id) continue;
        out[it.product_id] = (out[it.product_id] || 0) + (Number(it.quantity) || 0);
      }
    }
    return out;
  } catch (e) {
    console.warn('[availability] own-holds lookup failed:', e.message);
    return {};
  }
}

/**
 * The one-stop call for a reply path: products annotated with what is actually
 * free for THIS customer.
 *
 * Deliberately sequential rather than parallel. This runs on EVERY message, and
 * the overwhelmingly common case is a business with no unpaid orders open at
 * all — for which getHeldQuantities is a cache hit and there is nothing for the
 * customer's own holds to offset. Fetching those unconditionally would add a
 * database round trip per reply to buy nothing.
 */
export async function withAvailability(products, businessId, customerId = null) {
  const held = await getHeldQuantities(businessId);
  if (!Object.keys(held).length) return annotateAvailability(products, held);
  const own = customerId ? await getCustomerHolds(businessId, customerId) : {};
  return annotateAvailability(products, held, own);
}
