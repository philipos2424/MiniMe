/**
 * GET /api/admin/searcher?sid=<telegram_id> — one user's full activity.
 *
 * The master-admin drill-down behind the Search command center's searchers
 * table: a single person's use of @minimesearchbot + the Market.
 *
 * PRIVACY (deliberate): searchers stay PSEUDONYMOUS. We only ever surface the
 * numeric Telegram id — never a name/@username. We do NOT join the per-
 * business `customers` table to identify a searcher: that data was collected
 * under each business's own customer relationship, and reusing it to de-
 * anonymize platform-search behaviour would breach purpose limitation
 * (GDPR Art. 5(1)(b)) and data minimisation (Art. 5(1)(c)). This tool is
 * first-party service analytics under legitimate interest (Art. 6(1)(f));
 * the DELETE handler on /api/admin/search-metrics honours erasure (Art. 17).
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const sid = String(searchParams.get('sid') || '');
  if (!/^\d{1,32}$/.test(sid)) return NextResponse.json({ error: 'sid required' }, { status: 400 });

  const sb = supabase();

  const [
    { data: searches },
    { data: events },
    { data: waitlist },
    { data: referrals },
  ] = await Promise.all([
    fetchAllRows(() => sb.from('search_logs')
      .select('raw_query, parsed_intent, results_count, results_profile_ids, language, used_gpt, created_at')
      .eq('searcher_telegram_id', sid)
      .order('created_at', { ascending: false })),
    fetchAllRows(() => sb.from('market_events')
      .select('event_type, business_id, product_id, meta, created_at')
      .eq('tg_user_id', sid)
      .order('created_at', { ascending: false })),
    sb.from('search_waitlist')
      .select('raw_query, parsed_category, notified_at, created_at')
      .eq('searcher_telegram_id', sid)
      .order('created_at', { ascending: false }),
    fetchAllRows(() => sb.from('search_referrals')
      .select('business_id, landed, first_message_at, created_at')
      .eq('customer_telegram_id', sid)
      .order('created_at', { ascending: false })),
  ]);

  const allSearches = searches || [];
  const allEvents = events || [];
  const allRefs = referrals || [];

  // Resolve business + product names referenced anywhere, in two queries.
  const bizIds = new Set();
  const prodIds = new Set();
  for (const e of allEvents) { if (e.business_id) bizIds.add(e.business_id); if (e.product_id) prodIds.add(e.product_id); }
  for (const r of allRefs) if (r.business_id) bizIds.add(r.business_id);
  for (const s of allSearches) for (const id of (s.results_profile_ids || [])) bizIds.add(id);

  const [{ data: bizRows }, { data: prodRows }] = await Promise.all([
    bizIds.size ? sb.from('businesses').select('id, name').in('id', [...bizIds].slice(0, 500)) : Promise.resolve({ data: [] }),
    prodIds.size ? sb.from('products').select('id, name').in('id', [...prodIds].slice(0, 500)) : Promise.resolve({ data: [] }),
  ]);
  const bizName = Object.fromEntries((bizRows || []).map(b => [b.id, b.name]));
  const prodName = Object.fromEntries((prodRows || []).map(p => [p.id, p.name]));

  // ── Totals ──────────────────────────────────────────────────────────────
  const totals = {
    searches: allSearches.length,
    zeroResults: allSearches.filter(s => s.results_count === 0).length,
    am: allSearches.filter(s => s.language === 'am').length,
    en: allSearches.filter(s => s.language !== 'am').length,
    marketViews: allEvents.filter(e => e.event_type === 'view_product').length,
    orderTaps: allEvents.filter(e => e.event_type === 'click_chat').length,
    favorites: allEvents.filter(e => e.event_type === 'favorite').length,
    follows: allEvents.filter(e => e.event_type === 'follow').length,
    shares: allEvents.filter(e => e.event_type === 'share').length,
    referrals: allRefs.length,
    converted: allRefs.filter(r => r.first_message_at).length,
    waitlist: (waitlist || []).length,
  };

  const allDates = [
    ...allSearches.map(s => s.created_at),
    ...allEvents.map(e => e.created_at),
    ...allRefs.map(r => r.created_at),
  ].filter(Boolean).sort();

  return NextResponse.json({
    // Pseudonymous by design: only the last 4 digits leave the server for
    // display. The full sid is what the admin already passed in and is used
    // solely to key this read and the Art. 17 erase — it is not echoed back.
    masked: `…${sid.slice(-4)}`,
    firstSeen: allDates[0] || null,
    lastSeen: allDates[allDates.length - 1] || null,
    totals,
    searches: allSearches.slice(0, 100).map(s => ({
      query: s.raw_query,
      results: s.results_count,
      language: s.language,
      category: s.parsed_intent?.category || null,
      budget: s.parsed_intent?.budget || null,
      businesses: (s.results_profile_ids || []).map(id => bizName[id]).filter(Boolean).slice(0, 4),
      created_at: s.created_at,
    })),
    market: allEvents.slice(0, 100).map(e => ({
      event_type: e.event_type,
      business: e.business_id ? (bizName[e.business_id] || null) : null,
      product: e.product_id ? (prodName[e.product_id] || null) : null,
      q: e.meta?.q || null,
      via: e.meta?.via || null,
      created_at: e.created_at,
    })),
    waitlist: (waitlist || []).map(w => ({
      query: w.raw_query, category: w.parsed_category, notified: !!w.notified_at, created_at: w.created_at,
    })),
    referrals: allRefs.slice(0, 50).map(r => ({
      business: r.business_id ? (bizName[r.business_id] || '(removed)') : null,
      messaged: !!r.first_message_at,
      created_at: r.created_at,
    })),
  });
}
