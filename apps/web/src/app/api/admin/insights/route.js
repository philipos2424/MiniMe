/**
 * GET /api/admin/insights?days=30 — the admin Insights tab, in one payload.
 *
 * History comes from the nightly rollups (shop_daily / platform_daily); the
 * "today" panel and AI-by-model table read the last 24 h / 7 d live. All the
 * math is in lib/server/metrics/insights.mjs (pure, unit-tested).
 *
 * Privacy: aggregates only. This route never selects message text, buyer
 * identities, owner names, phones or handles. Telegram ids are read only to
 * count distinct onboarding people and drop internal owners; they are not in
 * the response (asserted in __tests__/metricsInsights.test.mjs).
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, dayKeyEAT } from '../../../../lib/server/fetch-all.mjs';
import { eatMidnightIso } from '../../../../lib/server/metrics/definitions.mjs';
import { buildInsights } from '../../../../lib/server/metrics/insights.mjs';
import { ENTRY_STEP } from '../../../../lib/server/metrics/attribution.mjs';
import { DAILY_SUMMARY_ROUTE } from '../../../../lib/server/llmCallLog.mjs';
import { PRO_PRICE_ETB } from '../../../../lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RANGES = [7, 30, 90, 365];
const DAY_MS = 86400000;
const BUSINESS_COLS = 'id, name, created_at, is_internal, owner_telegram_id, category_canonical, acquisition_source, source_channel_id, consent_at, notification_prefs, plan_tier, subscription_plan, subscription_status, trial_ends_at, subscription_expires_at, payment_verified, payment_proof_url, payment_ref';
const SHOP_COLS = 'business_id, day, inbound_messages, outbound_messages, failed_messages, ai_messages, customers_new, orders_created, orders_paid, paid_order_value_etb, first_reply_p50_s, owner_sessions, llm_calls, llm_failed, llm_cost_usd';
const ATTRIBUTION_STEPS = [ENTRY_STEP, 'sell_cta_tapped', 'referral_signup'];
const NO_STORE = { 'Cache-Control': 'no-store' };

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

async function count(label, query) {
  const { count: n, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return n || 0;
}

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });

  const asked = Number(new URL(request.url).searchParams.get('days'));
  const nDays = RANGES.includes(asked) ? asked : 30;
  const sb = supabase();
  const now = Date.now();
  const todayKey = dayKeyEAT(now);
  const dayOffset = n => dayKeyEAT(now - n * DAY_MS);

  // Twice the range for period-over-period deltas; at least 13 weeks for
  // cohorts and the 30-day segment windows.
  const lookbackFrom = dayOffset(Math.max(2 * nDays, 91) - 1);
  const rangeFrom = dayOffset(nDays - 1);
  const rangeFromIso = eatMidnightIso(rangeFrom);
  const iso = ms => new Date(ms).toISOString();

  try {
    const businesses = await must('businesses', fetchAllRows(() => sb.from('businesses').select(BUSINESS_COLS).order('id')));
    const internalIds = businesses.filter(b => b.is_internal === true).map(b => b.id);
    const buyersQ = () => {
      let q = sb.from('customers').select('id', { count: 'exact', head: true });
      if (internalIds.length) q = q.not('business_id', 'in', `(${internalIds.join(',')})`);
      return q;
    };

    const [shopRows, platformRows, onboardingEvents, recentMessages, llmRecent, audit, runs, total, active, fresh, activeNew, optedOut, attributionEvents, ordersAllTime] = await Promise.all([
      must('shop_daily', fetchAllRows(() => sb.from('shop_daily').select(SHOP_COLS)
        .gte('day', lookbackFrom).lte('day', todayKey).order('day').order('business_id'))),
      must('platform_daily', fetchAllRows(() => sb.from('platform_daily')
        .select('day, signups, trial_converted, subscribed, expired, source').gte('day', lookbackFrom).order('day'))),
      must('onboarding_events', fetchAllRows(() => sb.from('onboarding_events')
        .select('telegram_id, step, created_at').gte('created_at', rangeFromIso).order('id'))),
      must('messages', fetchAllRows(() => sb.from('messages')
        .select('business_id, direction, status, created_at').gte('created_at', iso(now - DAY_MS)).order('created_at').order('id'))),
      must('llm_call_log', fetchAllRows(() => sb.from('llm_call_log')
        .select('model, route, ok, latency_ms, prompt_tokens, completion_tokens, cached_tokens, total_cost_usd, created_at').neq('route', DAILY_SUMMARY_ROUTE).gte('created_at', iso(now - 7 * DAY_MS)).order('id'))),
      must('audit_logs', fetchAllRows(() => sb.from('audit_logs')
        .select('action').gte('created_at', iso(now - 30 * DAY_MS)).order('created_at').order('id'))),
      must('metrics_rollup_runs', sb.from('metrics_rollup_runs').select('ok, finished_at').order('started_at', { ascending: false }).limit(5)),
      count('customers total', buyersQ()),
      count('customers active', buyersQ().gte('last_active_at', rangeFromIso)),
      count('customers new', buyersQ().gte('created_at', rangeFromIso)),
      count('customers active new', buyersQ().gte('last_active_at', rangeFromIso).gte('created_at', rangeFromIso)),
      count('customers opted out', buyersQ().eq('broadcast_opted_out', true)),
      // All-time: first touch can predate the range by months.
      must('attribution events', fetchAllRows(() => sb.from('onboarding_events')
        .select('telegram_id, step, meta, created_at').in('step', ATTRIBUTION_STEPS).order('id'))),
      count('orders', sb.from('orders').select('id', { count: 'exact', head: true })),
    ]);

    const payload = buildInsights({
      nDays, now, businesses, shopRows, platformRows, onboardingEvents, recentMessages, llmRecent,
      buyers: { total, active, new: fresh, activeNew, optedOut }, audit, runs, proPriceEtb: PRO_PRICE_ETB,
      attributionEvents, ordersAllTime,
    });
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (e) {
    console.error('[admin/insights] failed:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500, headers: NO_STORE });
  }
}
