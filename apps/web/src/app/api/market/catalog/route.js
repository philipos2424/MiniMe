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
import { PRODUCT_SELECT, productChatUrl, onlyDiscoverable, mapProduct } from '../../../../lib/server/marketCatalog';
import { embedSearchQuery } from '../../../../lib/server/productEmbeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const SORTS = new Set(['newest', 'price_asc', 'price_desc', 'rating']);
const SEMANTIC_THRESHOLD = 0.35;
const SEMANTIC_TRIGGER = 6; // fall back to semantic search below this many ilike hits

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().slice(0, 100);
  const category = (searchParams.get('category') || '').trim().slice(0, 60);
  const offset = Math.max(0, parseInt(searchParams.get('offset'), 10) || 0);
  const limit = Math.min(48, Math.max(1, parseInt(searchParams.get('limit'), 10) || 24));
  const sort = SORTS.has(searchParams.get('sort')) ? searchParams.get('sort') : 'newest';
  const verifiedOnly = searchParams.get('verified') === '1';
  const id = searchParams.get('id') || '';
  // NOTE: check the raw param is PRESENT before Number() — Number(null) is 0,
  // which would silently treat every filter-less request as price_min=0
  // (turning on the price filter globally: wrong assist text, no shop
  // fallback, NULL-priced products excluded from all browsing).
  const priceMinRaw = searchParams.get('price_min');
  const priceMaxRaw = searchParams.get('price_max');
  const priceMin = Number(priceMinRaw);
  const priceMax = Number(priceMaxRaw);
  const hasPriceMin = priceMinRaw !== null && Number.isFinite(priceMin) && priceMin >= 0;
  const hasPriceMax = priceMaxRaw !== null && Number.isFinite(priceMax) && priceMax >= 0;
  const priceFilterActive = hasPriceMin || hasPriceMax;

  const sb = supabase();

  // Deep-link fetch: ?id=<uuid> returns just that product (share links,
  // /market?product=... entry). Same discoverability rules as browsing.
  if (id) {
    if (!UUID_RE.test(id)) return NextResponse.json({ items: [] });
    const { data } = await onlyDiscoverable(
      sb.from('products').select(PRODUCT_SELECT).eq('id', id)
    ).maybeSingle();
    return NextResponse.json({ items: data ? [mapProduct(data)] : [] });
  }

  // Verified/category/price are applied identically to the ilike query AND
  // the semantic re-fetch below, so a semantic hit can never sneak past a
  // filter the customer actually chose (that was the root cause of budget-
  // filtered searches surfacing unrelated/out-of-range items).
  function applyFilters(query) {
    let out = query;
    if (verifiedOnly) out = out.eq('businesses.verified', true);
    if (category) out = out.ilike('businesses.category', category);
    if (hasPriceMin) out = out.gte('price', priceMin);
    if (hasPriceMax) out = out.lte('price', priceMax);
    return out;
  }

  let query = applyFilters(onlyDiscoverable(sb.from('products').select(PRODUCT_SELECT)));

  if (sort === 'price_asc')       query = query.order('price', { ascending: true, nullsFirst: false });
  else if (sort === 'price_desc') query = query.order('price', { ascending: false, nullsFirst: false });
  else if (sort === 'rating')     query = query.order('average_rating', { foreignTable: 'businesses', ascending: false, nullsFirst: false });
  // Stable tiebreak + default order
  query = query.order('created_at', { ascending: false })
    .range(offset, offset + limit); // one extra row → hasMore

  if (q) {
    const safe = q.replace(/[%,()]/g, ' ');
    query = query.or(`name.ilike.%${safe}%,name_am.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[market] catalog error:', error.message);
    return NextResponse.json({ items: [], hasMore: false, businesses: [] });
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  // Default view keeps the "verified shops first" boost; explicit sorts
  // respect the user's chosen order.
  let page = rows.slice(0, limit);
  if (sort === 'newest') {
    page = page.sort((a, b) => (b.businesses?.verified === true) - (a.businesses?.verified === true));
  }

  let items = page.map(mapProduct);
  let usedSemantic = false;

  // Semantic fallback: a real query with few ilike hits (including a
  // specific product variation ilike can't match, or a typo) gets a
  // pgvector similarity pass over per-product embeddings. Hits are
  // re-fetched through applyFilters() so verified/category/price still
  // apply, then appended after the ilike hits, deduped, capped at limit.
  if (q && items.length < SEMANTIC_TRIGGER && !offset) {
    try {
      const embedding = await embedSearchQuery(q);
      if (embedding) {
        const { data: matches } = await sb.rpc('match_products_by_search', {
          query_embedding: embedding,
          match_threshold: SEMANTIC_THRESHOLD,
          match_count: 30,
        });
        const matchIds = (matches || []).map(m => m.id);
        if (matchIds.length) {
          const { data: semRows } = await applyFilters(
            onlyDiscoverable(sb.from('products').select(PRODUCT_SELECT))
          ).in('id', matchIds);
          const bySimilarity = new Map((matches || []).map(m => [m.id, m.similarity]));
          const seen = new Set(items.map(i => i.id));
          const semanticItems = (semRows || [])
            .sort((a, b) => (bySimilarity.get(b.id) || 0) - (bySimilarity.get(a.id) || 0))
            .map(mapProduct)
            .filter(p => !seen.has(p.id));
          if (semanticItems.length) {
            usedSemantic = true;
            items = [...items, ...semanticItems].slice(0, limit);
          }
        }
      }
    } catch (e) {
      console.warn('[market] semantic fallback failed:', e.message);
    }
  }

  // Conversational fallback: thin product results on a real query → surface
  // businesses whose profile/products/FAQs match the words, to chat with.
  // Skipped when a price filter is active — a shop can't be price-filtered,
  // so surfacing it here would ignore the range the customer chose.
  let businesses = [];
  if (q && items.length < 4 && !offset && !priceFilterActive) {
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
  if (!q && !category && !priceFilterActive) {
    assist = 'Tell me what you need — try "birthday cake", "laptop repair" or "habesha dress" 👇';
  } else if (items.length && priceFilterActive) {
    assist = `Found ${items.length}${hasMore ? '+' : ''} in that price range${q ? ` for "${q}"` : ''} — tap one to order.`;
  } else if (items.length) {
    assist = `Found ${items.length}${hasMore ? '+' : ''}${usedSemantic ? ' (closest matches)' : ''} for "${q || category}" — tap one to order${chips.length > 1 ? ', or narrow it down:' : '.'}`;
  } else if (priceFilterActive) {
    assist = `Nothing in that price range${q ? ` for "${q}"` : ''} — try widening it 👇`;
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
