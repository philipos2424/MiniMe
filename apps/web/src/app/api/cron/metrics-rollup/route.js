/**
 * GET /api/cron/metrics-rollup — nightly admin rollups (spec 2026-10-13 §3.3).
 *
 * Recomputes the last RECOMPUTE_DAYS EAT days into shop_daily / platform_daily
 * (upserts, so re-runs are idempotent and late events land on the right day).
 * When platform_daily is empty it backfills MAX_BACKFILL_DAYS instead, marked
 * source='backfill'. ?days=N overrides the window (1..MAX_BACKFILL_DAYS).
 *
 * Must run nightly: ux_events are purged at 90 days by data-retention, so
 * owner-session counts have to be captured before that.
 *
 * Scheduled 23:00 UTC = 02:00 EAT. Every run is logged to metrics_rollup_runs;
 * a failure DMs the platform admins.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { getAdminIds } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, lastNDaysEAT, dayKeyEAT } from '../../../../lib/server/fetch-all.mjs';
import { sendTelegramMessage } from '../../../../lib/server/telegram-send.mjs';
import { RECOMPUTE_DAYS, MAX_BACKFILL_DAYS, eatMidnightIso } from '../../../../lib/server/metrics/definitions.mjs';
import { buildShopDailyRows, buildPlatformDailyRows } from '../../../../lib/server/metrics/rollup.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UPSERT_CHUNK = 500;
const BUSINESS_COLS = 'id, created_at, is_internal, owner_telegram_id, plan_tier, subscription_plan, subscription_status, trial_ends_at, subscription_expires_at, payment_verified, payment_proof_url, payment_ref';

async function upsertChunked(sb, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

async function alertAdmins(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return;
  for (const id of getAdminIds()) {
    await sendTelegramMessage(token, { chat_id: id, text }).catch(() => {});
  }
}

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const sb = supabase();

  let nDays = Number(url.searchParams.get('days'));
  if (!Number.isInteger(nDays) || nDays < 1) {
    const { count } = await sb.from('platform_daily').select('day', { count: 'exact', head: true });
    nDays = count ? RECOMPUTE_DAYS : MAX_BACKFILL_DAYS;
  }
  nDays = Math.min(nDays, MAX_BACKFILL_DAYS);
  const source = nDays > RECOMPUTE_DAYS ? 'backfill' : 'cron';

  const now = Date.now();
  const days = lastNDaysEAT(nDays, now);
  const todayKey = dayKeyEAT(now);
  const since = eatMidnightIso(days[0]);
  const computedAt = new Date(now).toISOString();

  let runId = null;
  if (!dryRun) {
    const { data } = await sb.from('metrics_rollup_runs')
      .insert({ days_from: days[0], days_to: days[days.length - 1] }).select('id').single();
    runId = data?.id ?? null;
  }

  try {
    const [businesses, messages, customers, orders, llmCalls, aiUsage, uxEvents, onboardingEvents, subscriptionEvents] = await Promise.all([
      must('businesses', fetchAllRows(() => sb.from('businesses').select(BUSINESS_COLS).order('id'))),
      must('messages', fetchAllRows(() => sb.from('messages')
        .select('business_id, conversation_id, customer_id, direction, status, is_ai_generated, created_at')
        .gte('created_at', since).order('created_at').order('id'))),
      must('customers', fetchAllRows(() => sb.from('customers')
        .select('business_id, first_contact_at, created_at').gte('created_at', since).order('created_at').order('id'))),
      must('orders', fetchAllRows(() => sb.from('orders')
        .select('business_id, created_at, paid_at, refunded_at, total')
        .or(`created_at.gte.${since},paid_at.gte.${since}`).order('created_at').order('id'))),
      must('llm_call_log', fetchAllRows(() => sb.from('llm_call_log')
        .select('business_id, route, ok, total_cost_usd, created_at').gte('created_at', since).order('id'))),
      must('ai_usage', fetchAllRows(() => sb.from('ai_usage')
        .select('user_id, tokens_used, created_at').gte('created_at', since).order('created_at').order('id'))),
      must('ux_events', fetchAllRows(() => sb.from('ux_events')
        .select('business_id, surface, session_id, occurred_at, created_at')
        .eq('surface', 'dashboard').gte('created_at', since).order('id'))),
      must('onboarding_events', fetchAllRows(() => sb.from('onboarding_events')
        .select('telegram_id, step, created_at').gte('created_at', since).order('id'))),
      must('subscription_events', fetchAllRows(() => sb.from('subscription_events')
        .select('business_id, event, created_at').gte('created_at', since).order('created_at').order('id'))),
    ]);

    const shopRows = buildShopDailyRows({ days, todayKey, businesses, messages, customers, orders, llmCalls, aiUsage, uxEvents, source, computedAt });
    const platformRows = buildPlatformDailyRows({ days, shopRows, businesses, onboardingEvents, subscriptionEvents, source, computedAt });

    if (!dryRun) {
      // Two batches: PostgREST updates only the columns present in a batch,
      // so past-day rows (no plan_state key) never null the snapshot each
      // day got when it was "today".
      const withState = shopRows.filter(r => 'plan_state' in r);
      const withoutState = shopRows.filter(r => !('plan_state' in r));
      await upsertChunked(sb, 'shop_daily', withoutState, 'business_id,day');
      await upsertChunked(sb, 'shop_daily', withState, 'business_id,day');
      await upsertChunked(sb, 'platform_daily', platformRows, 'day');
      if (runId) await sb.from('metrics_rollup_runs').update({
        finished_at: new Date().toISOString(), shop_rows: shopRows.length, platform_rows: platformRows.length, ok: true,
      }).eq('id', runId);
    }

    return NextResponse.json({
      ok: true, dry_run: dryRun, source, days_from: days[0], days_to: days[days.length - 1],
      shop_rows: shopRows.length, platform_rows: platformRows.length,
    });
  } catch (e) {
    console.error('[cron/metrics-rollup] failed:', e.message);
    if (runId) await sb.from('metrics_rollup_runs').update({
      finished_at: new Date().toISOString(), ok: false, error: String(e.message).slice(0, 1000),
    }).eq('id', runId);
    if (!dryRun) await alertAdmins(`⚠️ Admin metrics rollup failed: ${String(e.message).slice(0, 300)}\nDashboard numbers are stale until it succeeds.`);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
