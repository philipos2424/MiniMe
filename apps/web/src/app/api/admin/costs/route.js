/**
 * GET /api/admin/costs?days=30
 * Admin-only: real API cost data from llm_call_log.
 * Returns both platform totals AND per-business breakdown.
 *
 * Cost alone only says a route is expensive. Three columns already on
 * llm_call_log say WHY, and were never selected here:
 *   - reasoning_tokens — hidden gpt-5.x thinking, billed at output rates.
 *     High share ⇒ fix with reasoning_effort, not with a smaller model.
 *   - cached_tokens    — prompt prefix served from OpenAI's cache at a
 *     discount. Low share on a big prompt ⇒ the prefix is unstable, fix by
 *     reordering the prompt so the static part comes first.
 *   - latency_ms       — for a chat product, reply speed IS the product;
 *     p95 is the number customers feel, and an average hides it.
 * Both token columns are nullable (non-OpenAI providers don't report them),
 * so they're summed over rows that actually reported, and the sample size is
 * returned alongside — a share computed over 3 of 9000 calls is not a fact.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Nearest-rank percentile over an unsorted numeric array. null when empty. */
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

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
    .select('route, model, ok, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, latency_ms, total_cost_usd, business_id, created_at')
    .gte('created_at', since)
    .neq('route', '__daily_summary__')
    .order('created_at', { ascending: false }));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Platform totals ───────────────────────────────────────────────────────────
  let totalCost = 0, totalCalls = 0, totalPrompt = 0, totalCompletion = 0, totalFails = 0;
  // Nullable columns: accumulate the value AND the number of rows that
  // reported it, so a share is never divided by calls that never had one.
  let totalCached = 0, cachedReported = 0;
  let totalReasoning = 0, reasoningReported = 0;
  const allLatencies = [];
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
    if (row.cached_tokens != null)    { totalCached += row.cached_tokens; cachedReported++; }
    if (row.reasoning_tokens != null) { totalReasoning += row.reasoning_tokens; reasoningReported++; }
    if (row.latency_ms != null) allLatencies.push(row.latency_ms);

    // Per-route
    const rk = `${row.route}::${row.model || 'unknown'}`;
    if (!byRoute[rk]) byRoute[rk] = {
      route: row.route, model: row.model, calls: 0, cost: 0, fails: 0,
      prompt: 0, cached: 0, cachedReported: 0, reasoning: 0, reasoningReported: 0, latencies: [],
    };
    byRoute[rk].calls++;
    byRoute[rk].cost += cost;
    byRoute[rk].prompt += prompt;
    if (!row.ok) byRoute[rk].fails++;
    if (row.cached_tokens != null)    { byRoute[rk].cached += row.cached_tokens; byRoute[rk].cachedReported++; }
    if (row.reasoning_tokens != null) { byRoute[rk].reasoning += row.reasoning_tokens; byRoute[rk].reasoningReported++; }
    if (row.latency_ms != null) byRoute[rk].latencies.push(row.latency_ms);

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
    .map(r => ({
      route: r.route, model: r.model, calls: r.calls, cost_usd: r4(r.cost),
      fail_rate: r.calls ? Math.round((r.fails / r.calls) * 100) : 0,
      // Share of prompt tokens served from cache — only over rows that
      // reported it, and null when nothing did (non-OpenAI providers).
      cached_pct: r.cachedReported > 0 && r.prompt > 0 ? Math.round((r.cached / r.prompt) * 100) : null,
      // Reasoning tokens per call: the lever reasoning_effort moves.
      reasoning_per_call: r.reasoningReported > 0 ? Math.round(r.reasoning / r.reasoningReported) : null,
      latency_p50_ms: percentile(r.latencies, 50),
      latency_p95_ms: percentile(r.latencies, 95),
    }));

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
      failed_calls: totalFails,
      cached_tokens: totalCached,
      reasoning_tokens: totalReasoning,
      // Shares are null, not 0, when no provider reported — "unknown" and
      // "genuinely zero" must stay distinguishable.
      cached_pct: cachedReported > 0 && totalPrompt > 0 ? Math.round((totalCached / totalPrompt) * 100) : null,
      reasoning_pct: reasoningReported > 0 && totalCompletion > 0 ? Math.round((totalReasoning / totalCompletion) * 100) : null,
      token_detail_coverage_pct: totalCalls ? Math.round((cachedReported / totalCalls) * 100) : 0,
      latency_p50_ms: percentile(allLatencies, 50),
      latency_p95_ms: percentile(allLatencies, 95),
      latency_sample: allLatencies.length,
    },
    top_routes: topRoutes,
    per_business: perBusiness,
    daily_trend: allDays,
  });
}
