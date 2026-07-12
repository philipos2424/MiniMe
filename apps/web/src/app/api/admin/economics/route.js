/**
 * GET /api/admin/economics — consolidated revenue view (MRR/ARR/trials/churn).
 *
 * Pulls together numbers that already exist scattered across /unit-economics
 * (GMV, LLM cost), /pulse (trial expiry) and businesses' subscription columns
 * into the single MRR/ARR/trial/churn shape a founder actually wants — no new
 * tables, no new tracking, just the missing rollup.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Actual subscription pricing (api/payment/subscribe/route.js) — the only
// paid plan today is Pro; monthly price is the MRR unit.
const MONTHLY_PRICE_ETB = 2500;

async function gate(request) {
  // Dual-auth: Telegram initData OR browser admin session cookie.
  return requireAdminRequest(request);
}

export async function GET(request) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 86400000).toISOString();
  const days30Ago = new Date(now.getTime() - 30 * 86400000).toISOString();
  const nowIso = now.toISOString();

  const { data: businesses } = await fetchAllRows(() => sb.from('businesses')
    .select('id, subscription_status, trial_started_at, trial_ends_at, updated_at, created_at')
    .order('created_at', { ascending: true }));

  const rows = businesses || [];
  const active = rows.filter(b => b.subscription_status === 'active');
  const trials = rows.filter(b => b.subscription_status === 'trial');
  const trialsExpiring7d = trials.filter(b => b.trial_ends_at && b.trial_ends_at > nowIso && b.trial_ends_at < in7days);

  // Real history, when subscription_events has rows (supabase/migrations/
  // subscription_events.sql) — otherwise fall back to the businesses.status
  // approximation below, which can't tell "converted then churned" from
  // "never converted".
  const { data: subEvents } = await fetchAllRows(() => sb.from('subscription_events')
    .select('business_id, event, created_at')
    .order('created_at', { ascending: true }));
  const hasHistory = (subEvents || []).length > 0;

  let trialToPaidRate;
  let churnRate30d;

  if (hasHistory) {
    const trialStarted = new Set((subEvents || []).filter(e => e.event === 'trial_started').map(e => e.business_id));
    const trialConverted = new Set((subEvents || []).filter(e => e.event === 'trial_converted').map(e => e.business_id));
    trialToPaidRate = trialStarted.size ? Math.round((trialConverted.size / trialStarted.size) * 100) : null;

    const recentEvents = (subEvents || []).filter(e => e.created_at >= days30Ago);
    const churnedRecently30d = new Set(recentEvents.filter(e => ['churned', 'expired'].includes(e.event)).map(e => e.business_id));
    const activeAtPeriodStart30d = active.length + churnedRecently30d.size;
    churnRate30d = activeAtPeriodStart30d > 0 ? Math.round((churnedRecently30d.size / activeAtPeriodStart30d) * 100) : null;
  } else {
    // Approximation — businesses that ever started a trial, of those how
    // many are now active. A trial that converted then churned reads as
    // "never converted" here.
    const everTrialed = rows.filter(b => b.trial_started_at);
    const convertedFromTrial = everTrialed.filter(b => b.subscription_status === 'active');
    trialToPaidRate = everTrialed.length ? Math.round((convertedFromTrial.length / everTrialed.length) * 100) : null;

    // Churn (30d), best-effort: businesses now cancelled/expired whose row
    // was last touched in the last 30 days, as a fraction of businesses
    // active at period start (active now + churned in the window). Not a
    // true point-in-time snapshot.
    const churnedRecently = rows.filter(b =>
      ['cancelled', 'expired'].includes(b.subscription_status) &&
      b.updated_at && b.updated_at >= days30Ago);
    const activeAtPeriodStart = active.length + churnedRecently.length;
    churnRate30d = activeAtPeriodStart > 0 ? Math.round((churnedRecently.length / activeAtPeriodStart) * 100) : null;
  }

  const mrrEtb = active.length * MONTHLY_PRICE_ETB;
  const arrEtb = mrrEtb * 12;
  const avgRevenuePerActive = active.length ? Math.round(mrrEtb / active.length) : 0;

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

  return NextResponse.json({
    trials_active: trials.length,
    trials_expiring_7d: trialsExpiring7d.length,
    trial_to_paid_rate: trialToPaidRate,
    mrr_etb: mrrEtb,
    arr_etb: arrEtb,
    avg_revenue_per_active_business: avgRevenuePerActive,
    active_businesses: active.length,
    churn_rate_30d: churnRate30d,
    revenue_at_risk: revenueAtRisk,
    history_based: hasHistory,
  });
}
