/**
 * GET /api/market/suggest?q=&tg_user_id= — search suggestions for the Market.
 *
 * { recent: [...last 5 distinct queries this user typed], popular: [...top
 *   queries platform-wide in the last 7 days, prefix-matched against q] }
 *
 * Sources: market_events (Market's own query log — see market/page.js
 * onSearch, which now logs view_market with meta.q) for recent AND half of
 * popular; search_logs (the MiniMe Search bot's own log) for the other half
 * of popular. Public, cheap, no LLM — this is autocomplete, not parsing.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uid = v => (/^\d{1,32}$/.test(String(v || '')) ? String(v) : null);

// Popular queries change slowly — cache platform-wide for a few minutes so a
// hot public endpoint doesn't hammer the DB on every keystroke.
let _popularCache = null; // { at, rows: [{query,count}] }
const POPULAR_TTL_MS = 5 * 60 * 1000;

async function loadPopular(sb) {
  if (_popularCache && Date.now() - _popularCache.at < POPULAR_TTL_MS) return _popularCache.rows;

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [{ data: logs }, { data: events }] = await Promise.all([
    sb.from('search_logs').select('raw_query').gt('results_count', 0).gte('created_at', since).limit(2000),
    sb.from('market_events').select('meta').eq('event_type', 'view_market').gte('created_at', since).limit(2000),
  ]);

  const freq = {};
  const bump = raw => {
    const q = String(raw || '').trim().toLowerCase().slice(0, 60);
    if (q.length < 2) return;
    freq[q] = (freq[q] || 0) + 1;
  };
  for (const l of logs || []) bump(l.raw_query);
  for (const e of events || []) if (e.meta?.q) bump(e.meta.q);

  const rows = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([query, count]) => ({ query, count }));

  _popularCache = { at: Date.now(), rows };
  return rows;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().toLowerCase().slice(0, 60);
  const tgUserId = uid(searchParams.get('tg_user_id'));

  const sb = supabase();

  const [recentRows, popularAll] = await Promise.all([
    tgUserId
      ? sb.from('market_events')
          .select('meta, created_at')
          .eq('event_type', 'view_market')
          .eq('tg_user_id', tgUserId)
          .not('meta->>q', 'is', null)
          .order('created_at', { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    loadPopular(sb),
  ]);

  const recent = [];
  const seenRecent = new Set();
  for (const row of recentRows.data || []) {
    const query = String(row.meta?.q || '').trim();
    const key = query.toLowerCase();
    if (!query || seenRecent.has(key)) continue;
    seenRecent.add(key);
    recent.push(query);
    if (recent.length >= 5) break;
  }

  const popular = (q ? popularAll.filter(p => p.query.startsWith(q)) : popularAll)
    .slice(0, 10)
    .map(p => p.query);

  return NextResponse.json({ recent, popular });
}
