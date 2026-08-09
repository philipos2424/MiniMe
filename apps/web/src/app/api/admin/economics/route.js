/**
 * GET /api/admin/economics?fx=155 — consolidated revenue view.
 *
 * Pulls together numbers that already exist scattered across /unit-economics
 * (GMV, LLM cost), /pulse (trial expiry) and businesses' subscription columns
 * into the single MRR/ARR/trial/churn shape a founder actually wants — no new
 * tables, no new tracking, just the missing rollup.
 *
 * Beyond the headline subscription numbers it answers the three questions a
 * status snapshot structurally cannot:
 *   - cohorts[]    — of the merchants who signed up in month X, how many are
 *                    still alive today? A single churn % can't tell you whether
 *                    retention is improving; monthly cohorts can.
 *   - channels[]   — businesses.acquisition_source joined to subscription
 *                    status, so "which channel sends merchants who PAY" is
 *                    answerable. The column has been captured since signup and
 *                    nothing ever read it.
 *   - margin       — MRR minus real LLM cost, in birr. GMV (in /unit-economics)
 *                    is the value the AI touches; this is money we keep.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Actual subscription pricing (api/payment/subscribe/route.js) — the only
// paid plan today is Pro; monthly price is the MRR unit.
const MONTHLY_PRICE_ETB = 1999;

async function gate(request) {
  // Dual-auth: Telegram initData OR browser admin session cookie.
  return requireAdminRequest(request);
}

export async function GET(request) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const now = new Date();
  // Birr per USD — LLM cost is billed in USD, subscriptions in birr; margin
  // math needs both in one unit. Same default/override as /unit-economics.
  const fx = Math.max(1, Number(new URL(request.url).searchParams.get('fx') || '155'));
  const in7days = new Date(now.getTime() + 7 * 86400000).toISOString();
  const days30Ago = new Date(now.getTime() - 30 * 86400000).toISOString();
  const nowIso = now.toISOString();

  const { data: businesses } = await fetchAllRows(() => sb.from('businesses')
    .select('id, subscription_status, trial_started_at, trial_ends_at, updated_at, created_at, acquisition_source, payment_verified, payment_ref, subscription_expires_at')
    .order('created_at', { ascending: true }));

  const rows = businesses || [];
  const active = rows.filter(b => b.subscription_status === 'active');
  const trials = rows.filter(b => b.subscription_status === 'trial');
  const trialsExpiring7d = trials.filter(b => b.trial_ends_at && b.trial_ends_at > nowIso && b.trial_ends_at < in7days);

  // ── What counts as "paying"? ────────────────────────────────────────────────
  // subscription_status='active' is NOT evidence of payment. On live data 675
  // businesses carry it, dating back to the platform's first week, while zero
  // have payment_verified and none has ever had a payment proof attached — the
  // status was clearly defaulted/backfilled, not earned. Multiplying it by the
  // monthly price produced an MRR of ~1.35M birr out of thin air.
  //
  // So MRR is computed off the strongest evidence that actually exists, and the
  // basis is reported alongside the number. The tiers, most trustworthy first:
  const tiers = [
    ['verified',    rows.filter(b => b.payment_verified === true)],
    ['payment_ref', rows.filter(b => b.payment_ref)],
    ['unexpired',   rows.filter(b => b.subscription_expires_at && b.subscription_expires_at > nowIso)],
    ['status',      active],
  ];
  const [mrrBasis, payingRows] = tiers.find(([, list]) => list.length > 0) || ['none', []];
  const payingIds = new Set(payingRows.map(b => b.id));

  // Say plainly where the numbers can't be trusted, rather than rendering a
  // confident figure built on a defaulted column.
  const dataQuality = [];
  if (mrrBasis !== 'verified') {
    dataQuality.push(
      `MRR is based on "${mrrBasis}" (${payingRows.length} businesses) — not one business has payment_verified=true, so no revenue figure here is confirmed.`);
  }
  if (active.length > payingRows.length) {
    dataQuality.push(
      `${active.length} businesses are marked subscription_status='active' but only ${payingRows.length} show payment evidence — the status column looks defaulted.`);
  }

  // Real history, when subscription_events has rows (supabase/migrations/
  // subscription_events.sql) — otherwise fall back to the businesses.status
  // approximation below, which can't tell "converted then churned" from
  // "never converted".
  const { data: subEvents } = await fetchAllRows(() => sb.from('subscription_events')
    .select('business_id, event, created_at')
    .order('created_at', { ascending: true }));
  // "Has history" has to mean the events the METRIC needs, not just any row.
  // The live log holds 63 trial_converted events from a single week in July and
  // nothing else — no trial_started, no churned, no expired. Treating that as
  // authoritative reported 0% churn (no churn events ÷ everything) and flagged
  // it history_based:true, which is a confident wrong answer. Absence of churn
  // events is missing data, not the absence of churn.
  const eventTypes = new Set((subEvents || []).map(e => e.event));
  const hasChurnHistory = eventTypes.has('churned') || eventTypes.has('expired');
  const hasTrialHistory = eventTypes.has('trial_started');
  const hasHistory = (subEvents || []).length > 0;

  let trialToPaidRate;
  let churnRate30d;

  if (hasTrialHistory) {
    const trialStarted = new Set((subEvents || []).filter(e => e.event === 'trial_started').map(e => e.business_id));
    const trialConverted = new Set((subEvents || []).filter(e => e.event === 'trial_converted').map(e => e.business_id));
    trialToPaidRate = trialStarted.size ? Math.round((trialConverted.size / trialStarted.size) * 100) : null;
  } else {
    const everTrialed = rows.filter(b => b.trial_started_at);
    const convertedFromTrial = everTrialed.filter(b => payingIds.has(b.id));
    trialToPaidRate = everTrialed.length ? Math.round((convertedFromTrial.length / everTrialed.length) * 100) : null;
    if (hasHistory) dataQuality.push('No trial_started events logged — trial→paid falls back to the businesses.trial_started_at approximation.');
  }

  if (hasChurnHistory) {
    const recentEvents = (subEvents || []).filter(e => e.created_at >= days30Ago);
    const churnedRecently30d = new Set(recentEvents.filter(e => ['churned', 'expired'].includes(e.event)).map(e => e.business_id));
    const activeAtPeriodStart30d = payingRows.length + churnedRecently30d.size;
    churnRate30d = activeAtPeriodStart30d > 0 ? Math.round((churnedRecently30d.size / activeAtPeriodStart30d) * 100) : null;
  } else {
    // Churn (30d), best-effort: businesses now cancelled/expired whose row
    // was last touched in the last 30 days, as a fraction of businesses
    // active at period start (active now + churned in the window). Not a
    // true point-in-time snapshot.
    const churnedRecently = rows.filter(b =>
      ['cancelled', 'expired'].includes(b.subscription_status) &&
      b.updated_at && b.updated_at >= days30Ago);
    const activeAtPeriodStart = payingRows.length + churnedRecently.length;
    churnRate30d = activeAtPeriodStart > 0 ? Math.round((churnedRecently.length / activeAtPeriodStart) * 100) : null;
    // No cancelled/expired rows AND no churn events is not 0% churn — it is
    // "churn has never been recorded". Report it as unknown.
    if (churnedRecently.length === 0) {
      churnRate30d = null;
      dataQuality.push('Churn is unknown: no churned/expired subscription_events and no cancelled/expired businesses. Nothing records a cancellation yet.');
    }
  }

  const mrrEtb = payingRows.length * MONTHLY_PRICE_ETB;
  const arrEtb = mrrEtb * 12;
  const avgRevenuePerActive = payingRows.length ? Math.round(mrrEtb / payingRows.length) : 0;

  // Revenue at risk: trials expiring soon that never really engaged (<5
  // messages) — these are the ones about to lapse with nothing to show for it.
  let revenueAtRisk = 0;
  if (trialsExpiring7d.length) {
    const ids = trialsExpiring7d.map(b => b.id);
    const { data: msgRows } = await sb.from('messages').select('business_id').in('business_id', ids).limit(10000);
    const msgCounts = {};
    for (const m of msgRows || []) msgCounts[m.business_id] = (msgCounts[m.business_id] || 0) + 1;
    revenueAtRisk = ids.filter(id => (msgCounts[id] || 0) < 5).length;
  }

  // ── Who is actually still alive? ────────────────────────────────────────────
  // "Active subscription" is a billing state; a merchant who pays but stopped
  // using the bot is already churned, we just haven't been told yet. Alive =
  // exchanged at least one message in the last 30 days.
  const { data: recentMsgs } = await fetchAllRows(() => sb.from('messages')
    .select('business_id').gte('created_at', days30Ago).order('created_at', { ascending: true }));
  const aliveIds = new Set((recentMsgs || []).map(m => m.business_id).filter(Boolean));

  // ── Monthly signup cohorts ──────────────────────────────────────────────────
  // A single churn % can't distinguish "we fixed onboarding" from "we didn't".
  // Cohorts can: read down the retained_pct column.
  const cohortMap = new Map();
  for (const b of rows) {
    if (!b.created_at) continue;
    const month = b.created_at.slice(0, 7); // YYYY-MM, UTC — month granularity, EAT skew is irrelevant
    if (!cohortMap.has(month)) cohortMap.set(month, { month, signups: 0, retained: 0, paying: 0, churned: 0 });
    const c = cohortMap.get(month);
    c.signups++;
    if (aliveIds.has(b.id)) c.retained++;
    if (payingIds.has(b.id)) c.paying++;
    if (['cancelled', 'expired'].includes(b.subscription_status)) c.churned++;
  }
  const cohorts = [...cohortMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map(c => ({
      ...c,
      retained_pct: c.signups ? Math.round((c.retained / c.signups) * 100) : 0,
      paying_pct: c.signups ? Math.round((c.paying / c.signups) * 100) : 0,
    }));

  // ── Acquisition channel → revenue ───────────────────────────────────────────
  // businesses.acquisition_source has been collected at signup since the
  // acquisition_source migration and never read. Without this join you can
  // count signups per channel but not tell which channel sends merchants who
  // pay — the only version of the question that decides a marketing budget.
  const channelMap = new Map();
  for (const b of rows) {
    const src = b.acquisition_source || 'unknown';
    if (!channelMap.has(src)) channelMap.set(src, { source: src, signups: 0, trials: 0, paying: 0, alive: 0 });
    const c = channelMap.get(src);
    c.signups++;
    if (b.trial_started_at) c.trials++;
    if (payingIds.has(b.id)) c.paying++;
    if (aliveIds.has(b.id)) c.alive++;
  }
  const channels = [...channelMap.values()]
    .map(c => ({
      ...c,
      mrr_etb: c.paying * MONTHLY_PRICE_ETB,
      signup_to_paid_pct: c.signups ? Math.round((c.paying / c.signups) * 100) : 0,
    }))
    .sort((a, b) => b.mrr_etb - a.mrr_etb || b.signups - a.signups);

  // ── Gross margin: subscription revenue minus what serving it costs ──────────
  // /unit-economics measures cost against GMV (merchant top-line, not ours).
  // This measures it against OUR revenue, which is the number that says
  // whether the business works.
  const { data: costRows } = await fetchAllRows(() => sb.from('llm_call_log')
    .select('total_cost_usd').gte('created_at', days30Ago)
    .neq('route', '__daily_summary__').order('created_at', { ascending: true }));
  const llmCostUsd30d = (costRows || []).reduce((s, r) => s + Number(r.total_cost_usd || 0), 0);
  const llmCostEtb30d = llmCostUsd30d * fx;
  const grossMarginEtb = mrrEtb - llmCostEtb30d;

  return NextResponse.json({
    trials_active: trials.length,
    trials_expiring_7d: trialsExpiring7d.length,
    trial_to_paid_rate: trialToPaidRate,
    mrr_etb: mrrEtb,
    arr_etb: arrEtb,
    avg_revenue_per_active_business: avgRevenuePerActive,
    active_businesses: payingRows.length,
    status_active_businesses: active.length,
    churn_rate_30d: churnRate30d,
    revenue_at_risk: revenueAtRisk,
    history_based: hasHistory,
    // Which evidence MRR is standing on, and every reason not to trust it.
    // The UI renders these verbatim — a wrong number the reader knows is wrong
    // is far less dangerous than a wrong number presented confidently.
    mrr_basis: mrrBasis,
    verified_payers: rows.filter(b => b.payment_verified === true).length,
    data_quality: dataQuality,
    // Usage-based liveness, which billing status alone can't see.
    alive_30d: rows.filter(b => aliveIds.has(b.id)).length,
    paying_but_silent: payingRows.filter(b => !aliveIds.has(b.id)).length,
    margin: {
      fx_birr_per_usd: fx,
      mrr_etb: mrrEtb,
      llm_cost_usd_30d: Math.round(llmCostUsd30d * 10000) / 10000,
      llm_cost_etb_30d: Math.round(llmCostEtb30d),
      gross_margin_etb: Math.round(grossMarginEtb),
      gross_margin_pct: mrrEtb > 0 ? Math.round((grossMarginEtb / mrrEtb) * 100) : null,
    },
    cohorts,
    channels,
  });
}
