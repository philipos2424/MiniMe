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
import { audit } from '../../../../lib/server/audit';
import { hotProducts, unmetDemand } from '../../../../lib/server/demand';
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

  const [{ data: logs }, { data: referrals }, { count: waitlistCount }, { data: waitlist }, { data: marketEvents }] = await Promise.all([
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
    fetchAllRows(() => sb.from('market_events')
      .select('tg_user_id, event_type, created_at')
      .not('tg_user_id', 'is', null)
      .gte('created_at', since30)
      .order('created_at', { ascending: true })),
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
  // Skip businesses that no longer exist — a triage/action list must never
  // show an item with nothing left to act on.
  const topBusinesses = topBizIds
    .filter(id => bizNames[id])
    .map(id => ({ id, name: bizNames[id], ...bizStats[id] }));

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
    businesses: Object.entries(f.bizIds).filter(([id]) => bizNames[id]).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, n]) => ({ name: bizNames[id], times: n })),
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

  // ── Searcher traction (pseudonymous by design) ─────────────────────────────
  // Compliance posture: we only ever hold searchers' NUMERIC Telegram ids —
  // never names/usernames (bots can't fetch them for users who merely message).
  // Purpose-limited service analytics (GDPR Art. 6(1)(f)); ids are MASKED in
  // the UI (`…` + last 4); full id travels only as an opaque `sid` for the
  // erase action below (Art. 17). Consistent with Telegram ToS — all data comes
  // from the user's own interactions with our bots.
  const mask = id => `…${String(id).slice(-4)}`;
  const searcherMap = {}; // tg id → rollup
  const S = id => searcherMap[id] || (searcherMap[id] = {
    searches: 0, zero: 0, am: 0, views: 0, clicks: 0, referrals: 0, converted: 0,
    firstSeen: null, lastSeen: null,
  });
  const touch = (s, at) => {
    if (!s.firstSeen || at < s.firstSeen) s.firstSeen = at;
    if (!s.lastSeen || at > s.lastSeen) s.lastSeen = at;
  };
  for (const l of allLogs) {
    if (!l.searcher_telegram_id) continue;
    const s = S(l.searcher_telegram_id);
    s.searches++;
    if (l.results_count === 0) s.zero++;
    if (l.language === 'am') s.am++;
    touch(s, l.created_at);
  }
  for (const r of allRefs) {
    if (!r.customer_telegram_id) continue;
    const s = S(r.customer_telegram_id);
    s.referrals++;
    if (r.first_message_at) s.converted++;
    touch(s, r.created_at);
  }
  for (const m of marketEvents || []) {
    const s = S(m.tg_user_id);
    if (m.event_type === 'click_chat') s.clicks++;
    else if (m.event_type === 'view_product') s.views++;
    touch(s, m.created_at);
  }
  const searchers = Object.entries(searcherMap)
    .sort((a, b) => (b[1].searches + b[1].views + b[1].clicks) - (a[1].searches + a[1].views + a[1].clicks))
    .slice(0, 30)
    .map(([id, s]) => ({ masked: mask(id), sid: String(id), ...s }));

  // Demand intelligence: most-wanted products + what people can't find.
  const [wanted, unmet] = await Promise.all([
    hotProducts({ days: 30, limit: 10 }).catch(() => []),
    unmetDemand({ days: 30, limit: 15 }).catch(() => []),
  ]);

  return NextResponse.json({
    daily: dailyOut,
    totals,
    topBusinesses,
    topQueries,
    failedQueries,
    categoryGaps,
    waitlist: waitlist || [],
    searchers,
    hotProducts: wanted,
    unmetDemand: unmet,
  });
}

/**
 * DELETE /api/admin/search-metrics — erase one searcher's data (Art. 17).
 * Body: { sid } (the searcher's Telegram id). Deletes their search_logs,
 * search_waitlist and market_events rows; search_referrals rows are kept as
 * ANONYMOUS conversion records (customer_telegram_id nulled) — mirroring how
 * eraseCustomerData preserves orders. Audit-logged.
 */
export async function DELETE(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body = {};
  try { body = await request.json(); } catch {}
  const sid = String(body.sid || '');
  if (!/^\d{1,32}$/.test(sid)) return NextResponse.json({ error: 'sid required' }, { status: 400 });

  const sb = supabase();
  const purge = async (label, run) => {
    try { await run(); } catch (e) { console.warn(`[searcher-erase] ${label} failed:`, e.message); }
  };
  await purge('search_logs', () => sb.from('search_logs').delete().eq('searcher_telegram_id', sid));
  await purge('search_waitlist', () => sb.from('search_waitlist').delete().eq('searcher_telegram_id', sid));
  await purge('market_events', () => sb.from('market_events').delete().eq('tg_user_id', sid));
  await purge('search_referrals', () => sb.from('search_referrals').update({ customer_telegram_id: null }).eq('customer_telegram_id', sid));

  await audit({
    business_id: null,
    actor_type: 'platform_admin',
    actor_id: tg.id,
    action: 'admin.searcher_erased',
    resource_type: 'searcher',
    resource_id: sid,
    request,
  });

  return NextResponse.json({ ok: true });
}
