/**
 * GET /api/admin/knowledge-gaps?days=30&status=open
 *
 * Platform-wide view of the questions MiniMe could not answer.
 *
 * knowledge_gaps has been written on every unanswerable customer question
 * since the knowledge_gaps migration, and no admin surface ever read it. It is
 * the highest-signal table on the platform: unlike search misses (which tell
 * you what the DIRECTORY lacks), each row is a real customer, in a real
 * conversation, hitting the edge of what a specific merchant taught the AI.
 *
 * Grouped two ways, because they answer different questions:
 *   - by_business — which merchants are under-taught (an onboarding/CS task)
 *   - clusters    — which QUESTIONS repeat across merchants (a product task:
 *                   the same gap at 20 shops is a missing feature, not 20
 *                   coaching calls)
 *
 * Clustering is deliberately lexical (normalised token overlap), not an
 * embedding call: this route must stay free to open. It groups obvious repeats
 * and does not pretend to be semantic.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Amharic-transliterated and English filler that carries no topic signal.
const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'did', 'you', 'your', 'i', 'we',
  'can', 'could', 'would', 'have', 'has', 'to', 'of', 'in', 'on', 'for', 'and',
  'or', 'it', 'this', 'that', 'me', 'my', 'be', 'what', 'how', 'when', 'where',
  'there', 'any', 'please', 'hi', 'hello',
]);

function keyOf(question) {
  const tokens = (question || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
  // The 4 rarest-looking tokens, sorted, as a crude topic fingerprint.
  // Same question phrased two ways usually shares them; different topics don't.
  return tokens.sort().slice(0, 4).join(' ') || '(no keywords)';
}

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 90);
  const statusFilter = url.searchParams.get('status') || 'all';
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const sb = supabase();

  const { data: gaps, error } = await fetchAllRows(() => {
    let q = sb.from('knowledge_gaps')
      .select('id, business_id, question, status, source, created_at, resolved_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true });
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    return q;
  });

  // The table ships in a standalone migration that may not have been applied
  // to every environment — report that honestly instead of rendering an empty
  // panel that looks like "no gaps, all good".
  if (error) {
    return NextResponse.json({
      ok: false,
      error: error.message,
      hint: 'knowledge_gaps table missing? apply supabase/migrations/knowledge_gaps.sql',
    }, { status: 500 });
  }

  const rows = gaps || [];

  // ── Per-business rollup ─────────────────────────────────────────────────────
  const byBiz = new Map();
  for (const g of rows) {
    if (!g.business_id) continue;
    if (!byBiz.has(g.business_id)) byBiz.set(g.business_id, { id: g.business_id, total: 0, open: 0, resolved: 0, latest: null });
    const b = byBiz.get(g.business_id);
    b.total++;
    if (g.status === 'open') b.open++;
    if (g.status === 'resolved') b.resolved++;
    if (!b.latest || g.created_at > b.latest) b.latest = g.created_at;
  }

  const bizIds = [...byBiz.keys()];
  let nameMap = {};
  if (bizIds.length) {
    const { data: bizRows } = await sb.from('businesses').select('id, name').in('id', bizIds);
    nameMap = Object.fromEntries((bizRows || []).map(b => [b.id, b.name]));
  }

  const byBusiness = [...byBiz.values()]
    .map(b => ({
      ...b,
      // A deleted business must not render as an actionable row.
      name: nameMap[b.id] || '(deleted business)',
      exists: Boolean(nameMap[b.id]),
      resolution_pct: b.total ? Math.round((b.resolved / b.total) * 100) : 0,
    }))
    .sort((a, b) => b.open - a.open || b.total - a.total);

  // ── Cross-merchant question clusters ────────────────────────────────────────
  const clusterMap = new Map();
  for (const g of rows) {
    const k = keyOf(g.question);
    if (!clusterMap.has(k)) clusterMap.set(k, { key: k, count: 0, open: 0, businesses: new Set(), examples: [] });
    const c = clusterMap.get(k);
    c.count++;
    if (g.status === 'open') c.open++;
    if (g.business_id) c.businesses.add(g.business_id);
    if (c.examples.length < 3) c.examples.push((g.question || '').slice(0, 160));
  }
  const clusters = [...clusterMap.values()]
    // Sorted by how many DISTINCT merchants hit it: a gap spanning many shops
    // is a product problem, one merchant asking 40 times is a coaching problem.
    .sort((a, b) => b.businesses.size - a.businesses.size || b.count - a.count)
    .slice(0, 25)
    .map(c => ({ key: c.key, count: c.count, open: c.open, business_count: c.businesses.size, examples: c.examples }));

  // ── Daily trend (EAT) ───────────────────────────────────────────────────────
  const buckets = Object.fromEntries(lastNDaysEAT(days).map(d => [d, 0]));
  for (const g of rows) {
    const k = dayKeyEAT(g.created_at);
    if (k in buckets) buckets[k]++;
  }
  const trend = Object.entries(buckets).map(([date, count]) => ({ date, count }));

  const open = rows.filter(g => g.status === 'open');
  const resolved = rows.filter(g => g.status === 'resolved');

  // Median hours from asked → answered, over resolved rows only.
  const resolveHours = resolved
    .filter(g => g.resolved_at && g.created_at)
    .map(g => (new Date(g.resolved_at) - new Date(g.created_at)) / 3600000)
    .sort((a, b) => a - b);
  const medianResolveHours = resolveHours.length
    ? Math.round(resolveHours[Math.floor(resolveHours.length / 2)] * 10) / 10
    : null;

  const bySource = {};
  for (const g of rows) bySource[g.source || 'unknown'] = (bySource[g.source || 'unknown'] || 0) + 1;

  return NextResponse.json({
    ok: true,
    period_days: days,
    totals: {
      total: rows.length,
      open: open.length,
      resolved: resolved.length,
      ignored: rows.filter(g => g.status === 'ignored').length,
      affected_businesses: byBiz.size,
      resolution_pct: rows.length ? Math.round((resolved.length / rows.length) * 100) : 0,
      median_resolve_hours: medianResolveHours,
    },
    by_source: bySource,
    by_business: byBusiness.slice(0, 50),
    clusters,
    trend,
    // Newest open questions verbatim — the founder-reading-the-raw-tape view.
    recent_open: open
      .slice(-40)
      .reverse()
      .map(g => ({
        id: g.id,
        business_id: g.business_id,
        business_name: nameMap[g.business_id] || '(deleted business)',
        question: (g.question || '').slice(0, 300),
        source: g.source,
        created_at: g.created_at,
      })),
  });
}
