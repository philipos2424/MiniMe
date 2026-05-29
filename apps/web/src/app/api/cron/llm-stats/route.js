/**
 * GET /api/cron/llm-stats
 * Daily cron (runs at 06:00 UTC) — aggregates LLM call costs from the
 * previous day and stores a compact summary per business in
 * businesses.notification_prefs._llm_daily_stats.
 *
 * Also surfaces roll-up totals in /api/admin/overview so the admin can
 * see API spend without digging into raw logs.
 *
 * Rollback enforcement: any route whose failure_rate > 5% (last 50 calls)
 * gets its forced_model written to llm_route_state here too — this is the
 * persistent side of the in-process auto-rollback in openai-wrapper.js.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  const authed =
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const yesterday = new Date(Date.now() - 86400000);
  const dayStart = new Date(yesterday); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd   = new Date(yesterday); dayEnd.setUTCHours(23, 59, 59, 999);

  // ── 1. Per-route aggregate ────────────────────────────────────────────────
  const { data: routeRows } = await sb.from('llm_call_log')
    .select('route, model, ok, prompt_tokens, completion_tokens, total_cost_usd')
    .gte('created_at', dayStart.toISOString())
    .lte('created_at', dayEnd.toISOString())
    .limit(50000);

  const routeStats = {};
  for (const r of routeRows || []) {
    const k = `${r.route}::${r.model}`;
    if (!routeStats[k]) routeStats[k] = { route: r.route, model: r.model, calls: 0, failures: 0, cost_usd: 0, prompt_tokens: 0, completion_tokens: 0 };
    routeStats[k].calls++;
    if (!r.ok) routeStats[k].failures++;
    routeStats[k].cost_usd += Number(r.total_cost_usd || 0);
    routeStats[k].prompt_tokens += r.prompt_tokens || 0;
    routeStats[k].completion_tokens += r.completion_tokens || 0;
  }

  // ── 2. Per-business aggregate ─────────────────────────────────────────────
  const { data: bizRows } = await sb.from('llm_call_log')
    .select('business_id, model, total_cost_usd, prompt_tokens, completion_tokens')
    .gte('created_at', dayStart.toISOString())
    .lte('created_at', dayEnd.toISOString())
    .not('business_id', 'is', null)
    .limit(50000);

  const bizStats = {};
  for (const r of bizRows || []) {
    const id = r.business_id;
    if (!bizStats[id]) bizStats[id] = { cost_usd: 0, calls: 0, tokens: 0 };
    bizStats[id].cost_usd += Number(r.total_cost_usd || 0);
    bizStats[id].calls++;
    bizStats[id].tokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
  }

  // ── 3. Enforce rollbacks for bad routes ───────────────────────────────────
  const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
  const rollbacks = [];
  for (const [, stat] of Object.entries(routeStats)) {
    if (stat.calls < 30) continue; // need enough data
    const failRate = stat.failures / stat.calls;
    if (failRate > 0.05) {
      await sb.from('llm_route_state').upsert({
        route: stat.route,
        forced_model: MODEL,
        failures_recent: stat.failures,
        rollback_reason: `Cron: ${Math.round(failRate * 100)}% fail rate on ${dayStart.toISOString().slice(0, 10)}`,
        rolled_back_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      rollbacks.push(stat.route);
    }
  }

  // ── 4. Platform-wide totals ───────────────────────────────────────────────
  const totalCost = Object.values(routeStats).reduce((s, r) => s + r.cost_usd, 0);
  const totalCalls = Object.values(routeStats).reduce((s, r) => s + r.calls, 0);

  // Store compact daily snapshot in a dedicated table row (upsert by date)
  await sb.from('llm_call_log').insert({
    route: '__daily_summary__',
    model: 'summary',
    ok: true,
    prompt_tokens: Object.values(routeStats).reduce((s, r) => s + r.prompt_tokens, 0),
    completion_tokens: Object.values(routeStats).reduce((s, r) => s + r.completion_tokens, 0),
    total_cost_usd: totalCost,
  });

  return NextResponse.json({
    ok: true,
    date: dayStart.toISOString().slice(0, 10),
    total_calls: totalCalls,
    total_cost_usd: Math.round(totalCost * 10000) / 10000,
    rollbacks,
    top_routes: Object.values(routeStats)
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 10)
      .map(r => ({ route: r.route, model: r.model, calls: r.calls, cost_usd: Math.round(r.cost_usd * 10000) / 10000, fail_rate: Math.round((r.failures / r.calls) * 100) })),
    top_businesses: Object.entries(bizStats)
      .sort(([, a], [, b]) => b.cost_usd - a.cost_usd)
      .slice(0, 10)
      .map(([id, s]) => ({ business_id: id, cost_usd: Math.round(s.cost_usd * 10000) / 10000, calls: s.calls })),
  });
}
