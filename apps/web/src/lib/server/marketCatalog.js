/**
 * Shared Market catalog helpers — one product mapper + discoverability filter
 * used by /api/market/{catalog,for-you,favorites,shop} so every endpoint
 * returns the exact same safe product shape and chat deep links.
 */

export const BIZ_COLS = 'name, verified, category, telegram_bot_username, shop_code, logo_url, average_rating, total_reviews';

export const PRODUCT_SELECT = `id, name, name_am, description, price, currency, image_url, business_id, created_at, businesses!inner(${BIZ_COLS}, b2b_discoverable, onboarding_completed)`;

/** Product-carrying deep link: the bot opens the chat ALREADY on this product
 *  ("You were looking at X — want it?") instead of a cold welcome. Custom bots
 *  get start=mp-<id>; the shared bot needs the shop code for tenant routing,
 *  so the product rides after a "__" separator (start params allow A-Za-z0-9_-,
 *  64 max: 5+8+2+36 = 51 chars). */
export function productChatUrl(biz, productId) {
  if (biz?.telegram_bot_username) return `https://t.me/${biz.telegram_bot_username}?start=mp-${productId}`;
  if (biz?.shop_code) return `https://t.me/MiniMeAgentBot?start=shop_${biz.shop_code}__${productId}`;
  return null;
}

/** Restrict a products query (joined on businesses!inner) to discoverable,
 *  reachable shops — the same rule the public catalog has always used. */
export function onlyDiscoverable(query) {
  return query
    .eq('is_active', true)
    .eq('businesses.b2b_discoverable', true)
    .or('telegram_bot_username.not.is.null,and(shop_code.not.is.null,onboarding_completed.eq.true)', { foreignTable: 'businesses' });
}

/** Map a joined product row to the safe public shape the Market UI renders. */
export function mapProduct(p) {
  return {
    id: p.id,
    name: p.name,
    name_am: p.name_am || null,
    description: p.description ? String(p.description).slice(0, 300) : null,
    price: p.price,
    currency: p.currency || 'ETB',
    image_url: p.image_url || null,
    business_id: p.business_id,
    business_name: p.businesses?.name || '',
    business_logo: p.businesses?.logo_url || null,
    verified: !!p.businesses?.verified,
    category: p.businesses?.category || null,
    average_rating: p.businesses?.average_rating || null,
    total_reviews: p.businesses?.total_reviews || 0,
    chat_url: productChatUrl(p.businesses, p.id),
  };
}
