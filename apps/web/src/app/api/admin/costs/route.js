/**
 * GET /api/admin/costs?days=30
 * Admin-only: real API cost data from llm_call_log.
 * Returns both platform totals AND per-business breakdown.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(request) {
  // Dual-auth: Telegram initData OR browser admin session cookie.
  return requireAdminRequest(request);
}

export async function GET(request) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const days = Math.min(parseInt(new URL(request.url).searchParams.get('days') || '30', 10), 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const sb = supabase();

  // Pull all logs for the period (skip internal summary rows). Paginated:
  // Supabase caps each response at 1000 rows, so a plain .limit(100000)
  // silently reported only the newest 1000 calls' worth of cost.
  const { data: logs, error } = await fetchAllRows(() => sb.from('llm_call_log')
    .select('route, model, ok, prompt_tokens, completion_tokens, total_cost_usd, business_id, created_at')
    .gte('created_at', since)
    .neq('route', '__daily_summary__')
    .order('created_at', { ascending: false }));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Platform totals ───────────────────────────────────────────────────────────
  let totalCost = 0, totalCalls = 0, totalPrompt = 0, totalCompletion = 0, totalFails = 0;
  const byRoute = {};
  const byBusiness = {};
  const byDay = {};

  // Fetch business names for the breakdown
  const { data: bizNames } = await fetchAllRows(() => sb.from('businesses').select('id, name').order('created_at', { ascending: true }));
  const nameMap = Object.fromEntries((bizNames || []).map(b => [b.id, b.name]));

  for (const row of logs || []) {
    const cost = Number(row.total_cost_usd || 0);
    const prompt = row.prompt_tokens || 0;
    const completion = row.completion_tokens || 0;
    totalCost += cost;
    totalCalls++;
    totalPrompt += prompt;
    totalCompletion += completion;
    if (!row.ok) totalFails++;

    // Per-route
    const rk = `${row.route}::${row.model || 'unknown'}`;
    if (!byRoute[rk]) byRoute[rk] = { route: row.route, model: row.model, calls: 0, cost: 0, fails: 0 };
    byRoute[rk].calls++;
    byRoute[rk].cost += cost;
    if (!row.ok) byRoute[rk].fails++;

    // Per-business
    const bk = row.business_id || '__platform__';
    if (!byBusiness[bk]) byBusiness[bk] = { id: bk, name: nameMap[bk] || (bk === '__platform__' ? 'Platform (no business)' : bk), calls: 0, cost: 0, tokens: 0 };
    byBusiness[bk].calls++;
    byBusiness[bk].cost += cost;
    byBusiness[bk].tokens += prompt + completion;

    // Per-day (for chart) — bucketed in EAT so days match merchant local time
    const dk = dayKeyEAT(row.created_at);
    if (!byDay[dk]) byDay[dk] = { date: dk, cost: 0, calls: 0 };
    byDay[dk].cost += cost;
    byDay[dk].calls++;
  }

  // Round everything
  const r4 = v => Math.round(v * 10000) / 10000;

  const topRoutes = Object.values(byRoute)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 15)
    .map(r => ({ route: r.route, model: r.model, calls: r.calls, cost_usd: r4(r.cost), fail_rate: r.calls ? Math.round((r.fails / r.calls) * 100) : 0 }));

  const perBusiness = Object.values(byBusiness)
    .sort((a, b) => b.cost - a.cost)
    .map(b => ({ id: b.id, name: b.name, calls: b.calls, cost_usd: r4(b.cost), tokens: b.tokens }));

  // Fill in missing days with zero
  const allDays = lastNDaysEAT(days).map(dk =>
    byDay[dk] ? { date: dk, cost: r4(byDay[dk].cost), calls: byDay[dk].calls } : { date: dk, cost: 0, calls: 0 });

  return NextResponse.json({
    ok: true,
    period_days: days,
    totals: {
      cost_usd: r4(totalCost),
      calls: totalCalls,
      prompt_tokens: totalPrompt,
      completion_tokens: totalCompletion,
      fail_rate: totalCalls ? Math.round((totalFails / totalCalls) * 100) : 0,
    },
    top_routes: topRoutes,
    per_business: perBusiness,
    daily_trend: allDays,
  });
}
