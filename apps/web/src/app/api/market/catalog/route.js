/**
 * GET /api/market/catalog — public product catalog for the MiniMe Market Mini App.
 *
 * Params: q (text search), category (business category), offset, limit (≤48).
 * Returns { items, hasMore, businesses } — items are products of discoverable
 * businesses (verified shops first, then newest); when a text query matches
 * few products, `businesses` carries keyword-matched shops ("shops that can
 * help") via the search bot's searchDirectory, so "birthday cake for 20"
 * still gets the customer to a caterer to chat with.
 *
 * Public by design — same trust model as /directory. Only safe columns leave
 * the server; chat_url is built here so the client never assembles links.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { searchDirectory, contactUrlFor } from '../../../../lib/server/searchBot';
import { trendingProducts } from '../../../../lib/server/demand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BIZ_COLS = 'name, verified, category, telegram_bot_username, shop_code, logo_url';

/** Product-carrying deep link: the bot opens the chat ALREADY on this product
 *  ("You were looking at X — want it?") instead of a cold welcome. Custom bots
 *  get start=mp-<id>; the shared bot needs the shop code for tenant routing,
 *  so the product rides after a "__" separator (start params allow A-Za-z0-9_-,
 *  64 max: 5+8+2+36 = 51 chars). */
function productChatUrl(biz, productId) {
  if (biz?.telegram_bot_username) return `https://t.me/${biz.telegram_bot_username}?start=mp-${productId}`;
  if (biz?.shop_code) return `https://t.me/MiniMeAgentBot?start=shop_${biz.shop_code}__${productId}`;
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().slice(0, 100);
  const category = (searchParams.get('category') || '').trim().slice(0, 60);
  const offset = Math.max(0, parseInt(searchParams.get('offset'), 10) || 0);
  const limit = Math.min(48, Math.max(1, parseInt(searchParams.get('limit'), 10) || 24));

  const sb = supabase();
  let query = sb.from('products')
    .select(`id, name, name_am, description, price, currency, image_url, business_id, created_at, businesses!inner(${BIZ_COLS}, b2b_discoverable, onboarding_completed)`)
    .eq('is_active', true)
    .eq('businesses.b2b_discoverable', true)
    .or('telegram_bot_username.not.is.null,and(shop_code.not.is.null,onboarding_completed.eq.true)', { foreignTable: 'businesses' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit); // one extra row → hasMore

  if (q) {
    const safe = q.replace(/[%,()]/g, ' ');
    query = query.or(`name.ilike.%${safe}%,name_am.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  if (category) query = query.ilike('businesses.category', category);

  const { data, error } = await query;
  if (error) {
    console.error('[market] catalog error:', error.message);
    return NextResponse.json({ items: [], hasMore: false, businesses: [] });
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  // Verified shops first, then keep newest-first within each group.
  const page = rows.slice(0, limit)
    .sort((a, b) => (b.businesses?.verified === true) - (a.businesses?.verified === true));

  const items = page.map(p => ({
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
    chat_url: productChatUrl(p.businesses, p.id),
  }));

  // Conversational fallback: thin product results on a real query → surface
  // businesses whose profile/products/FAQs match the words, to chat with.
  let businesses = [];
  if (q && items.length < 4 && !offset) {
    try {
      const keywords = q.toLowerCase().split(/\s+/).filter(w => w.length >= 3).slice(0, 5);
      if (keywords.length) {
        const found = await searchDirectory({ keywords, limit: 5 });
        const inItems = new Set(items.map(i => i.business_id));
        businesses = found
          .filter(b => !inItems.has(b.id))
          // Personal-use accounts (no category, no profile text) never surface
          // in the marketplace — only real shops belong here.
          .filter(b => b.category || b.tagline || b.description)
          .map(b => ({
            id: b.id,
            name: b.name,
            verified: !!b.verified,
            tagline: b.tagline || (b.description ? String(b.description).slice(0, 100) : null),
            logo_url: b.logo_url || null,
            average_rating: b.average_rating || null,
            total_reviews: b.total_reviews || 0,
            chat_url: contactUrlFor(b, 'market'),
          }));
      }
    } catch (e) {
      console.warn('[market] business fallback failed:', e.message);
    }
  }

  // Conversational assist — the Market "talks back". Rule-based on what the
  // query actually produced (zero LLM cost/latency in a public endpoint);
  // chips are tappable refinements the page can re-query with.
  const catCounts = {};
  for (const it of items) if (it.category) catCounts[it.category] = (catCounts[it.category] || 0) + 1;
  const chips = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
  let assist;
  if (!q && !category) {
    assist = 'Tell me what you need — try "birthday cake", "laptop repair" or "habesha dress" 👇';
  } else if (items.length) {
    assist = `Found ${items.length}${hasMore ? '+' : ''} for "${q || category}" — tap one to order${chips.length > 1 ? ', or narrow it down:' : '.'}`;
  } else if (businesses.length) {
    assist = `Nothing exact for "${q}" — but these shops can help you 👇`;
  } else {
    assist = `Nothing for "${q}" yet — try different words, or ask MiniMe Search 💬`;
  }

  // Trending — only on the default home view (no query/category, first page).
  // Cached in the demand engine, so this is cheap on a hot public endpoint.
  let trending = [];
  if (!q && !category && !offset) {
    try {
      const hot = await trendingProducts({ limit: 8 });
      trending = hot.map(p => ({
        id: p.id, name: p.name, name_am: p.name_am, price: p.price, currency: p.currency,
        image_url: p.image_url, business_id: p.business_id, business_name: p.business_name,
        verified: p.verified,
        chat_url: productChatUrl({ telegram_bot_username: p.telegram_bot_username, shop_code: p.shop_code }, p.id),
      }));
    } catch (e) { console.warn('[market] trending failed:', e.message); }
  }

  return NextResponse.json({ items, hasMore, businesses, assist, chips, trending });
}
