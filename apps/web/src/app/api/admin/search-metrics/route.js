/**
 * GET /api/admin/search-metrics — MiniMe Search usage dashboard data.
 *
 * Replaces the client-side supabase-browser queries the search-analytics page
 * used to run (capped at 500 rows and dependent on the anon key). Aggregates
 * server-side over the full 30-day window:
 *  - daily[]: per-EAT-day searches, zero-results, unique searchers, language
 *    split, referrals created/converted
 *  - totals: 7d/30d volume + unique searchers, zero-result %, cache-hit %,
 *    click-through (referrals ÷ searches with results), conversion
 *    (first real message ÷ referrals)
 *  - topBusinesses: who search surfaces, with referral/conversion counts
 *  - topQueries / failedQueries / categoryGaps / waitlist
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const since7iso = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ data: logs }, { data: referrals }, { count: waitlistCount }, { data: waitlist }] = await Promise.all([
    fetchAllRows(() => sb.from('search_logs')
      .select('id, raw_query, parsed_intent, results_count, results_profile_ids, language, used_gpt, searcher_telegram_id, created_at')
      .gte('created_at', since30)
      .order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('search_referrals')
      .select('business_id, customer_telegram_id, landed, first_message_at, search_log_id, created_at')
      .gte('created_at', since30)
      .order('created_at', { ascending: true })),
    sb.from('search_waitlist').select('id', { count: 'exact', head: true }).is('notified_at', null),
    sb.from('search_waitlist').select('raw_query, parsed_category, created_at')
      .is('notified_at', null).order('created_at', { ascending: false }).limit(30),
  ]);

  const allLogs = logs || [];
  const allRefs = referrals || [];

  // ── Daily buckets (EAT) ────────────────────────────────────────────────────
  const days = lastNDaysEAT(30);
  const daily = Object.fromEntries(days.map(d => [d, {
    day: d, searches: 0, zeroResults: 0, am: 0, en: 0,
    referrals: 0, converted: 0, searchers: new Set(),
  }]));
  for (const l of allLogs) {
    const d = daily[dayKeyEAT(l.created_at)];
    if (!d) continue;
    d.searches++;
    if (l.results_count === 0) d.zeroResults++;
    if (l.language === 'am') d.am++; else d.en++;
    if (l.searcher_telegram_id) d.searchers.add(l.searcher_telegram_id);
  }
  for (const r of allRefs) {
    const d = daily[dayKeyEAT(r.created_at)];
    if (!d) continue;
    d.referrals++;
    if (r.first_message_at) d.converted++;
  }
  const dailyOut = days.map(k => {
    const { searchers, ...rest } = daily[k];
    return { ...rest, uniqueSearchers: searchers.size };
  });

  // ── Totals ─────────────────────────────────────────────────────────────────
  const logs7 = allLogs.filter(l => l.created_at >= since7iso);
  const refs7 = allRefs.filter(r => r.created_at >= since7iso);
  const uniq = rows => new Set(rows.map(l => l.searcher_telegram_id).filter(Boolean)).size;
  const withResults30 = allLogs.filter(l => l.results_count > 0).length;
  const zero30 = allLogs.filter(l => l.results_count === 0).length;
  const cached30 = allLogs.filter(l => l.used_gpt === false).length;
  const converted30 = allRefs.filter(r => r.first_message_at).length;
  const pct = (num, den) => den > 0 ? Math.round((num / den) * 100) : 0;

  const totals = {
    searches7: logs7.length,
    searches30: allLogs.length,
    uniqueSearchers7: uniq(logs7),
    uniqueSearchers30: uniq(allLogs),
    zeroResults30: zero30,
    zeroRate30: pct(zero30, allLogs.length),
    cacheHitRate30: pct(cached30, allLogs.length),
    cachedSearches30: cached30,
    am30: allLogs.filter(l => l.language === 'am').length,
    en30: allLogs.filter(l => l.language !== 'am').length,
    referrals7: refs7.length,
    referrals30: allRefs.length,
    ctr30: pct(allRefs.length, withResults30),
    converted30,
    conversionRate30: pct(converted30, allRefs.length),
    waitlistCount: waitlistCount || 0,
  };

  // ── Top businesses surfaced ────────────────────────────────────────────────
  const bizStats = {}; // id → { surfaced, referrals, converted }
  for (const l of allLogs) {
    for (const id of l.results_profile_ids || []) {
      (bizStats[id] || (bizStats[id] = { surfaced: 0, referrals: 0, converted: 0 })).surfaced++;
    }
  }
  for (const r of allRefs) {
    if (!r.business_id) continue;
    const s = bizStats[r.business_id] || (bizStats[r.business_id] = { surfaced: 0, referrals: 0, converted: 0 });
    s.referrals++;
    if (r.first_message_at) s.converted++;
  }
  const topBizIds = Object.entries(bizStats)
    .sort((a, b) => b[1].surfaced - a[1].surfaced)
    .slice(0, 15)
    .map(([id]) => id);
  let bizNames = {};
  if (topBizIds.length) {
    const { data: bizRows } = await sb.from('businesses').select('id, name').in('id', topBizIds);
    bizNames = Object.fromEntries((bizRows || []).map(b => [b.id, b.name]));
  }
  const topBusinesses = topBizIds.map(id => ({
    id, name: bizNames[id] || '(deleted)', ...bizStats[id],
  }));

  // ── Query rollups (over ALL rows, not the old 500-row client cap) ──────────
  const refsByLogId = {};
  for (const r of allRefs) {
    if (!r.search_log_id) continue;
    const e = refsByLogId[r.search_log_id] || (refsByLogId[r.search_log_id] = { referrals: 0, converted: 0 });
    e.referrals++;
    if (r.first_message_at) e.converted++;
  }

  const freq = {}; // query → rollup
  for (const l of allLogs) {
    const q = (l.raw_query || '').toLowerCase().trim().slice(0, 60);
    if (!q) continue;
    const f = freq[q] || (freq[q] = { count: 0, zeroCount: 0, am: 0, referrals: 0, converted: 0, bizIds: {} });
    f.count++;
    if (l.results_count === 0) f.zeroCount++;
    if (l.language === 'am') f.am++;
    const ref = refsByLogId[l.id];
    if (ref) { f.referrals += ref.referrals; f.converted += ref.converted; }
    for (const id of l.results_profile_ids || []) f.bizIds[id] = (f.bizIds[id] || 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1].count - a[1].count);

  // Per-query detail for the top 15 — resolve surfaced business names in one shot
  const detailBizIds = [...new Set(sorted.slice(0, 15).flatMap(([, f]) =>
    Object.entries(f.bizIds).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id)))]
    .filter(id => !(id in bizNames));
  if (detailBizIds.length) {
    const { data: extra } = await sb.from('businesses').select('id, name').in('id', detailBizIds);
    for (const b of extra || []) bizNames[b.id] = b.name;
  }
  const topQueries = sorted.slice(0, 15).map(([q, f]) => ({
    query: q, count: f.count, zeroCount: f.zeroCount, am: f.am,
    referrals: f.referrals, converted: f.converted,
    businesses: Object.entries(f.bizIds).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, n]) => ({ name: bizNames[id] || '(deleted)', times: n })),
  }));

  const failedQueries = sorted
    .filter(([, f]) => f.zeroCount > 0)
    .sort((a, b) => b[1].zeroCount - a[1].zeroCount)
    .slice(0, 15)
    .map(([q, f]) => ({ query: q, count: f.zeroCount, total: f.count }));

  const catFreq = {};
  for (const l of allLogs) {
    if (l.results_count === 0 && l.parsed_intent?.category) {
      catFreq[l.parsed_intent.category] = (catFreq[l.parsed_intent.category] || 0) + 1;
    }
  }
  const categoryGaps = Object.entries(catFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return NextResponse.json({
    daily: dailyOut,
    totals,
    topBusinesses,
    topQueries,
    failedQueries,
    categoryGaps,
    waitlist: waitlist || [],
  });
}
