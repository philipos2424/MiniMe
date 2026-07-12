/**
 * GET /api/admin/unit-economics?days=30&fx=155
 * Admin-only: the three founder/investor metrics joined PER MERCHANT.
 *   1. Quality  — % of AI replies sent WITHOUT owner correction (auto-send accuracy)
 *   2. ROI/GMV  — birr of paid GMV attributable to AI-handled conversations
 *   3. Cost     — LLM cost (USD) per active merchant, from llm_call_log
 * Plus margin flags so we can see at a glance which merchants are
 * upside-down (cost > value), churn-risk (zero GMV) or low-quality (high edit rate).
 *
 * Everything is computed from data already captured — no new instrumentation.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAID = ['paid', 'fulfilled', 'completed'];

async function gate(request) {
  // Dual-auth: Telegram initData OR browser admin session cookie.
  return requireAdminRequest(request);
}

export async function GET(request) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 90);
  // Birr per USD — used to put cost & GMV in the same unit for margin math.
  const fx = Math.max(1, Number(url.searchParams.get('fx') || '155'));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const sb = supabase();

  // ── Pull the raw inputs in parallel. All scoped by created_at; grouped in JS. ──
  const [
    { data: businesses, error: bizErr },
    { data: msgs, error: msgErr },
    { data: orders, error: ordErr },
    { data: logs, error: logErr },
  ] = await Promise.all([
    // Paginated: Supabase caps each response at 1000 rows regardless of
    // .limit(), which silently truncated quality/GMV/cost inputs.
    fetchAllRows(() => sb.from('businesses')
      .select('id, name, plan_tier, subscription_plan, created_at, trust_level')
      .order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('messages')
      .select('business_id, direction, is_ai_generated, owner_edited, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('orders')
      .select('business_id, total, currency, status, customer_id, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('llm_call_log')
      .select('business_id, total_cost_usd, prompt_tokens, completion_tokens, created_at')
      .gte('created_at', since)
      .neq('route', '__daily_summary__')
      .order('created_at', { ascending: true })),
  ]);

  const err = bizErr || msgErr || ordErr || logErr;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  // Seed a per-merchant accumulator for every known business.
  const M = {};
  const seed = (id, name) => {
    if (!M[id]) M[id] = {
      id, name: name || id,
      ai_sent: 0, ai_edited: 0,          // quality
      inbound: 0,
      gmv: 0, paid_orders: 0, payers: new Set(),  // ROI
      cost_usd: 0, calls: 0, tokens: 0,  // cost
    };
    return M[id];
  };
  const meta = {};
  for (const b of businesses || []) {
    seed(b.id, b.name);
    meta[b.id] = { plan: b.plan_tier || b.subscription_plan || 'free', trust_level: b.trust_level ?? null, created_at: b.created_at };
  }

  // 1. Quality — AI outbound auto-sent vs owner-corrected.
  for (const m of msgs || []) {
    if (!m.business_id) continue;
    const r = seed(m.business_id);
    if (m.direction === 'inbound') r.inbound++;
    if (m.is_ai_generated && m.direction === 'outbound') {
      if (m.owner_edited) r.ai_edited++;
      else r.ai_sent++;
    }
  }

  // 2. ROI / GMV — paid birr.
  for (const o of orders || []) {
    if (!o.business_id) continue;
    const r = seed(o.business_id);
    if (PAID.includes((o.status || '').toLowerCase())) {
      r.gmv += Number(o.total || 0);
      r.paid_orders++;
      if (o.customer_id) r.payers.add(o.customer_id);
    }
  }

  // 3. Cost — LLM spend in USD.
  for (const l of logs || []) {
    const id = l.business_id || '__platform__';
    const r = seed(id, id === '__platform__' ? 'Platform (no business)' : null);
    r.cost_usd += Number(l.total_cost_usd || 0);
    r.calls++;
    r.tokens += (l.prompt_tokens || 0) + (l.completion_tokens || 0);
  }

  const r2 = v => Math.round(v * 100) / 100;
  const r4 = v => Math.round(v * 10000) / 10000;

  // ── Per-merchant rows with derived metrics + flags ──────────────────────────
  const rows = Object.values(M).map(r => {
    const aiTotal = r.ai_sent + r.ai_edited;
    const quality_pct = aiTotal > 0 ? Math.round((r.ai_sent / aiTotal) * 100) : null;
    const edit_rate_pct = aiTotal > 0 ? Math.round((r.ai_edited / aiTotal) * 100) : null;
    const cost_birr = r.cost_usd * fx;
    // Margin = paid GMV minus LLM cost, in birr. (GMV is top-line, not profit —
    // but it's the value the AI is touching, so cost should be a tiny fraction.)
    const margin_birr = r.gmv - cost_birr;
    const cost_per_birr_gmv = r.gmv > 0 ? r4(cost_birr / r.gmv) : null;
    const active = (r.inbound > 0 || r.calls > 0);

    const flags = [];
    if (active && r.gmv === 0) flags.push('zero_gmv');               // churn / value-at-risk
    if (active && cost_birr > 0 && margin_birr < 0) flags.push('upside_down'); // cost > GMV
    if (edit_rate_pct !== null && edit_rate_pct >= 30) flags.push('low_quality'); // owner correcting a lot
    if (active && aiTotal === 0 && r.calls > 0) flags.push('no_autosend'); // spending but not sending

    return {
      id: r.id,
      name: r.name,
      plan: meta[r.id]?.plan ?? null,
      trust_level: meta[r.id]?.trust_level ?? null,
      active,
      // quality
      ai_sent: r.ai_sent,
      ai_edited: r.ai_edited,
      ai_total: aiTotal,
      quality_pct,
      edit_rate_pct,
      inbound: r.inbound,
      // roi
      gmv_birr: Math.round(r.gmv),
      paid_orders: r.paid_orders,
      payers: r.payers.size,
      // cost
      cost_usd: r4(r.cost_usd),
      cost_birr: Math.round(cost_birr),
      calls: r.calls,
      tokens: r.tokens,
      // economics
      margin_birr: Math.round(margin_birr),
      cost_per_birr_gmv,
      flags,
    };
  }).sort((a, b) => b.gmv_birr - a.gmv_birr || b.cost_usd - a.cost_usd);

  // ── Blended platform totals ─────────────────────────────────────────────────
  const activeRows = rows.filter(r => r.active);
  const totalCostUsd = rows.reduce((s, r) => s + r.cost_usd, 0);
  const totalGmv = rows.reduce((s, r) => s + r.gmv_birr, 0);
  const totalAiSent = rows.reduce((s, r) => s + r.ai_sent, 0);
  const totalAiEdited = rows.reduce((s, r) => s + r.ai_edited, 0);
  const totalAiTotal = totalAiSent + totalAiEdited;
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);

  const totals = {
    period_days: days,
    fx_birr_per_usd: fx,
    active_merchants: activeRows.length,
    total_merchants: (businesses || []).length,
    // quality
    quality_pct: totalAiTotal > 0 ? Math.round((totalAiSent / totalAiTotal) * 100) : null,
    edit_rate_pct: totalAiTotal > 0 ? Math.round((totalAiEdited / totalAiTotal) * 100) : null,
    ai_sent: totalAiSent,
    ai_total: totalAiTotal,
    // roi
    gmv_birr: totalGmv,
    gmv_per_active_birr: activeRows.length ? Math.round(totalGmv / activeRows.length) : 0,
    // cost
    cost_usd: r2(totalCostUsd),
    cost_birr: Math.round(totalCostUsd * fx),
    cost_per_active_usd: activeRows.length ? r4(totalCostUsd / activeRows.length) : 0,
    cost_per_active_birr: activeRows.length ? Math.round((totalCostUsd * fx) / activeRows.length) : 0,
    cost_per_call_usd: totalCalls ? r4(totalCostUsd / totalCalls) : 0,
    calls: totalCalls,
    // blended economics
    cost_per_birr_gmv: totalGmv > 0 ? r4((totalCostUsd * fx) / totalGmv) : null,
    margin_birr: Math.round(totalGmv - totalCostUsd * fx),
  };

  const flagged = {
    upside_down: rows.filter(r => r.flags.includes('upside_down')).length,
    zero_gmv: rows.filter(r => r.flags.includes('zero_gmv')).length,
    low_quality: rows.filter(r => r.flags.includes('low_quality')).length,
    no_autosend: rows.filter(r => r.flags.includes('no_autosend')).length,
  };

  return NextResponse.json({ ok: true, totals, flagged, merchants: rows });
}
