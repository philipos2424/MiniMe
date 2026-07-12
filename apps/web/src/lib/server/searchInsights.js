/**
 * Per-business search & market analytics — the aggregation behind the OWNER
 * dashboard (Settings → MiniMe Search) and reused, admin-gated, for the
 * platform admin's per-business drill-down. Extracted from
 * api/dashboard/search-insights/route.js so both callers share one
 * implementation instead of drifting apart.
 */
import { supabase } from './db';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from './fetch-all.mjs';
import { hotProducts, unmetDemand } from './demand';

/**
 * @param {{ id: string, category?: string }} business
 * @param {{ days?: number }} opts
 */
export async function buildSearchInsights(business, { days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const sb = supabase();

  const [
    { data: logs },
    { data: referrals },
    { data: events },
    ordersRes,
    paidOrdersRes,
    products,
    missedDemand,
    waitlistRes,
  ] = await Promise.all([
    // Searches where this business appeared in the results
    fetchAllRows(() => sb.from('search_logs')
      .select('id, raw_query, language, results_count, created_at')
      .contains('results_profile_ids', [business.id])
      .gte('created_at', since)
      .order('created_at', { ascending: true })),
    // Clicks from search results into this business's bot
    fetchAllRows(() => sb.from('search_referrals')
      .select('id, search_log_id, first_message_at, created_at')
      .eq('business_id', business.id)
      .gte('created_at', since)
      .order('created_at', { ascending: true })),
    // Market interactions with this business (views, order taps, favorites…)
    fetchAllRows(() => sb.from('market_events')
      .select('event_type, product_id, tg_user_id, created_at')
      .eq('business_id', business.id)
      .gte('created_at', since)
      .order('created_at', { ascending: true })),
    sb.from('orders').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id).gte('created_at', since),
    sb.from('orders').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id).eq('status', 'paid').gte('created_at', since),
    hotProducts({ days, limit: 20, businessId: business.id }),
    business.category ? unmetDemand({ days, limit: 10, category: business.category }) : Promise.resolve([]),
    business.category
      ? sb.from('search_waitlist').select('id', { count: 'exact', head: true })
          .eq('parsed_category', business.category).is('notified_at', null)
      : Promise.resolve({ count: 0 }),
  ]);

  const clickEvents = (events || []).filter(e => e.event_type === 'click_chat');

  // ── Daily buckets (EAT) ────────────────────────────────────────────────────
  const dayKeys = lastNDaysEAT(days);
  const buckets = Object.fromEntries(dayKeys.map(d => [d, { day: d, appearances: 0, clicks: 0, referrals: 0 }]));
  for (const l of logs || [])      { const b = buckets[dayKeyEAT(l.created_at)]; if (b) b.appearances++; }
  for (const e of clickEvents)     { const b = buckets[dayKeyEAT(e.created_at)]; if (b) b.clicks++; }
  for (const r of referrals || []) { const b = buckets[dayKeyEAT(r.created_at)]; if (b) b.referrals++; }
  const daily = dayKeys.map(d => buckets[d]);

  // ── Totals + trend (last 7d vs previous 7d appearances) ──────────────────
  const appearances   = (logs || []).length;
  const referralCount = (referrals || []).length;
  const conversations = (referrals || []).filter(r => r.first_message_at).length;
  const clicks        = clickEvents.length;

  const last7 = daily.slice(-7).reduce((s, d) => s + d.appearances, 0);
  const prev7 = daily.slice(-14, -7).reduce((s, d) => s + d.appearances, 0);
  const trendPct = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : (last7 > 0 ? 100 : 0);

  // ── Language split ────────────────────────────────────────────────────────
  const languages = { am: 0, en: 0 };
  for (const l of logs || []) {
    if ((l.language || '').toLowerCase().startsWith('am')) languages.am++;
    else languages.en++;
  }

  // ── Top queries that surfaced this business ──────────────────────────────
  const queryAgg = {};
  for (const l of logs || []) {
    const q = (l.raw_query || '').toLowerCase().trim().slice(0, 60);
    if (!q) continue;
    queryAgg[q] = (queryAgg[q] || 0) + 1;
  }
  const topQueries = Object.entries(queryAgg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }));

  // ── Converted queries: referral.search_log_id → raw_query ────────────────
  const logById = new Map((logs || []).map(l => [l.id, l]));
  const missingIds = [...new Set((referrals || [])
    .map(r => r.search_log_id)
    .filter(id => id && !logById.has(id)))];
  if (missingIds.length) {
    const { data: extra } = await sb.from('search_logs')
      .select('id, raw_query')
      .in('id', missingIds.slice(0, 200));
    for (const l of extra || []) logById.set(l.id, l);
  }
  const convAgg = {}; // query → { referrals, converted }
  for (const r of referrals || []) {
    const log = r.search_log_id ? logById.get(r.search_log_id) : null;
    if (!log?.raw_query) continue;
    const q = log.raw_query.toLowerCase().trim().slice(0, 60);
    const e = convAgg[q] || (convAgg[q] = { referrals: 0, converted: 0 });
    e.referrals++;
    if (r.first_message_at) e.converted++;
  }
  const convertedQueries = Object.entries(convAgg)
    .sort((a, b) => (b[1].converted - a[1].converted) || (b[1].referrals - a[1].referrals))
    .slice(0, 10)
    .map(([query, v]) => ({ query, ...v }));

  return {
    days,
    daily,
    totals: {
      appearances,
      clicks,
      referrals: referralCount,
      conversations,
      ctr: appearances > 0 ? Math.round((referralCount / appearances) * 100) : 0,
      trendPct,
    },
    products: (products || []).map(p => ({
      id: p.id, name: p.name, name_am: p.name_am, price: p.price, currency: p.currency,
      image_url: p.image_url, views: p.views, clicks: p.clicks, click_rate: p.click_rate,
    })),
    topQueries,
    missedDemand: (missedDemand || []).map(m => ({
      query: m.query, searches: m.searches, waiting: m.waiting, lastAt: m.lastAt,
    })),
    waitlistCount: waitlistRes?.count || 0,
    languages,
    convertedQueries,
    // Orders are NOT referral-attributed — these are orders in the same period.
    funnel: {
      appearances,
      clicks: referralCount,
      conversations,
      orders: ordersRes?.count || 0,
      paidOrders: paidOrdersRes?.count || 0,
    },
  };
}
