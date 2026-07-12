/**
 * Demand intelligence — turns the raw signals the platform already logs
 * (market_events, search_logs, search_waitlist) into three views:
 *
 *   hotProducts()      — most-wanted products, ranked by order-clicks (intent)
 *   unmetDemand()      — what people search for and DON'T find (+ who's waiting)
 *   trendingProducts() — 7d hot list with a cheap in-memory cache, safe to call
 *                        from the public catalog endpoint
 *
 * No new tables — pure aggregation. This is the engine behind the flywheel:
 * admins see what to recruit, merchants get told what to stock, customers see
 * what's popular.
 */
import { supabase } from './db';
import { fetchAllRows } from './fetch-all.mjs';

/**
 * Most-wanted products over the window, ranked by click_chat (order intent),
 * then views. Inactive/deleted products are excluded.
 */
export async function hotProducts({ days = 7, limit = 10, businessId = null } = {}) {
  const sb = supabase();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: events } = await fetchAllRows(() => {
    let q = sb.from('market_events')
      .select('event_type, product_id')
      .not('product_id', 'is', null)
      .in('event_type', ['view_product', 'click_chat'])
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    if (businessId) q = q.eq('business_id', businessId);
    return q;
  });

  const byProduct = {}; // id → { views, clicks }
  for (const e of events || []) {
    const s = byProduct[e.product_id] || (byProduct[e.product_id] = { views: 0, clicks: 0 });
    if (e.event_type === 'click_chat') s.clicks++; else s.views++;
  }

  const topIds = Object.entries(byProduct)
    .sort((a, b) => (b[1].clicks - a[1].clicks) || (b[1].views - a[1].views))
    .slice(0, limit * 2) // over-fetch: some will be inactive/deleted
    .map(([id]) => id);
  if (!topIds.length) return [];

  let prodQuery = sb.from('products')
    .select('id, name, name_am, price, currency, image_url, business_id, is_active, businesses!inner(name, verified, telegram_bot_username, shop_code)')
    .in('id', topIds)
    .eq('is_active', true);
  if (businessId) prodQuery = prodQuery.eq('business_id', businessId);
  const { data: prods } = await prodQuery;

  const rows = (prods || []).map(p => {
    const s = byProduct[p.id] || { views: 0, clicks: 0 };
    return {
      id: p.id,
      name: p.name,
      name_am: p.name_am || null,
      price: p.price,
      currency: p.currency || 'ETB',
      image_url: p.image_url || null,
      business_id: p.business_id,
      business_name: p.businesses?.name || '',
      verified: !!p.businesses?.verified,
      telegram_bot_username: p.businesses?.telegram_bot_username || null,
      shop_code: p.businesses?.shop_code || null,
      views: s.views,
      clicks: s.clicks,
      click_rate: s.views > 0 ? Math.round((s.clicks / s.views) * 100) : (s.clicks > 0 ? 100 : 0),
    };
  });
  return rows
    .sort((a, b) => (b.clicks - a.clicks) || (b.views - a.views))
    .slice(0, limit);
}

/**
 * Unmet demand: zero-result searches grouped by normalized query, enriched
 * with how many people are actively waiting for a match. The recruiting /
 * stocking hit-list.
 */
export async function unmetDemand({ days = 30, limit = 15, category = null } = {}) {
  const sb = supabase();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [{ data: zeroLogs }, { data: waitRows }] = await Promise.all([
    fetchAllRows(() => {
      let q = sb.from('search_logs')
        .select('raw_query, parsed_intent, created_at')
        .eq('results_count', 0)
        .gte('created_at', since)
        .order('created_at', { ascending: true });
      if (category) q = q.eq('parsed_intent->>category', category);
      return q;
    }),
    fetchAllRows(() => {
      let q = sb.from('search_waitlist')
        .select('raw_query, parsed_category')
        .is('notified_at', null)
        .order('created_at', { ascending: true });
      if (category) q = q.eq('parsed_category', category);
      return q;
    }),
  ]);

  const norm = q => (q || '').toLowerCase().trim().slice(0, 60);

  const waitingByQuery = {};
  for (const w of waitRows || []) {
    const q = norm(w.raw_query);
    if (q) waitingByQuery[q] = (waitingByQuery[q] || 0) + 1;
  }

  const byQuery = {}; // query → { searches, waiting, category, lastAt }
  for (const l of zeroLogs || []) {
    const q = norm(l.raw_query);
    if (!q) continue;
    const e = byQuery[q] || (byQuery[q] = { searches: 0, waiting: waitingByQuery[q] || 0, category: null, lastAt: null });
    e.searches++;
    if (l.parsed_intent?.category) e.category = l.parsed_intent.category;
    if (!e.lastAt || l.created_at > e.lastAt) e.lastAt = l.created_at;
  }
  // Waitlist-only entries (e.g. captured via the Market notify button before
  // any zero-result log in the window) still count as demand.
  for (const [q, waiting] of Object.entries(waitingByQuery)) {
    if (!byQuery[q]) byQuery[q] = { searches: 0, waiting, category: null, lastAt: null };
  }

  return Object.entries(byQuery)
    .sort((a, b) => (b[1].searches + b[1].waiting) - (a[1].searches + a[1].waiting))
    .slice(0, limit)
    .map(([query, v]) => ({ query, ...v }));
}

/**
 * Abandonment rate: successful searches (results_count > 0) that never led
 * to a referral click — "we showed them something, they ignored it all".
 * Distinct from the zero-result rate ("we had nothing to show"). Only
 * meaningful now that search_referrals.search_log_id actually exists
 * (search_referrals_fk_fix.sql) — before that fix this join silently
 * returned nothing.
 */
export async function searchAbandonment({ days = 30 } = {}) {
  const sb = supabase();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [{ data: logs }, { data: refs }] = await Promise.all([
    fetchAllRows(() => sb.from('search_logs')
      .select('id')
      .gt('results_count', 0)
      .gte('created_at', since)),
    fetchAllRows(() => sb.from('search_referrals')
      .select('search_log_id')
      .not('search_log_id', 'is', null)
      .gte('created_at', since)),
  ]);

  const successfulSearches = (logs || []).length;
  if (!successfulSearches) return { successfulSearches: 0, clicked: 0, abandoned: 0, abandonmentRate: 0 };

  const clickedLogIds = new Set((refs || []).map(r => r.search_log_id));
  const clicked = (logs || []).filter(l => clickedLogIds.has(l.id)).length;
  const abandoned = successfulSearches - clicked;
  return {
    successfulSearches,
    clicked,
    abandoned,
    abandonmentRate: Math.round((abandoned / successfulSearches) * 100),
  };
}

/**
 * Trending products for the public Market home. Cached in-memory for 10
 * minutes per instance — the catalog endpoint is public and hot, and
 * "popular right now" doesn't need to be second-accurate.
 */
let _trendCache = null; // { at, rows }
const TREND_TTL_MS = 10 * 60 * 1000;

export async function trendingProducts({ limit = 8 } = {}) {
  if (_trendCache && Date.now() - _trendCache.at < TREND_TTL_MS) {
    return _trendCache.rows.slice(0, limit);
  }
  const rows = await hotProducts({ days: 7, limit });
  _trendCache = { at: Date.now(), rows };
  return rows;
}
