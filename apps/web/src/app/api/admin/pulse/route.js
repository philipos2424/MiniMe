/**
 * GET /api/admin/pulse — triage dashboard: is the platform broken, and where
 * are we leaking users?
 *
 * One call returns:
 *  - status/statusReasons: 'red' when messages drop >50% (vs the same time
 *    yesterday, not a lopsided full-day comparison), AI cost is $0 despite
 *    real message volume, or the 1h webhook success rate (from webhook_events,
 *    min sample 10) drops below 90% — a heartbeat check, not a KPI.
 *  - alerts[]: things that need action, each carrying structured business
 *    targets (id/name) so the UI can render one-click fixes per business.
 *    Panic-mode alerts only consider currently-active businesses; nothing
 *    here ever names a business that no longer exists.
 *  - today / yesterday: EAT-day counts for messages, orders, revenue,
 *    new customers, searches, signups, market activity, AI cost.
 *  - funnel: Signup → Searchable → Surfaced → Messaged → Ordered, with the
 *    single worst-converting stage flagged — replaces the old raw event feed.
 *  - mostWanted: only computed past 100 messages/day (vanity noise below that).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { hotProducts } from '../../../../lib/server/demand';
import { businessLeakFunnel } from '../../../../lib/server/platformFunnel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Merchants are Ethiopian — "today" means the EAT (UTC+3, no DST) calendar day.
const EAT_MS = 3 * 3600 * 1000;
function eatDayStartUtc(daysAgo = 0) {
  const eatNow = Date.now() + EAT_MS;
  const dayStartEat = Math.floor(eatNow / 86400000) * 86400000 - daysAgo * 86400000;
  return new Date(dayStartEat - EAT_MS).toISOString();
}

const PAID = ['paid', 'fulfilled', 'completed'];

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const todayStart = eatDayStartUtc(0);
  const yesterdayStart = eatDayStartUtc(1);
  const twoDaysAgo = new Date(Date.now() - 48 * 3600000).toISOString();
  const in5days = new Date(Date.now() + 5 * 86400000).toISOString();
  const nowIso = new Date().toISOString();
  // Fair "same time yesterday" window — comparing partial today to all of
  // yesterday always looks like a crash in the morning.
  const elapsedMs = Date.now() - new Date(todayStart).getTime();
  const yesterdaySameTime = new Date(new Date(yesterdayStart).getTime() + elapsedMs).toISOString();

  const countIn = (table, from, to, extra) => {
    let q = sb.from(table).select('id', { count: 'exact', head: true })
      .gte('created_at', from).lt('created_at', to);
    if (extra) q = extra(q);
    return q;
  };

  const [
    // today vs yesterday
    { count: msgsToday }, { count: msgsYest }, { count: msgsYestSoFar },
    { count: ordersToday }, { count: ordersYest },
    { data: revToday }, { data: revYest },
    { count: custToday }, { count: custYest },
    { count: searchToday }, { count: searchYest },
    { count: signupsToday }, { count: signupsYest },
    { count: zeroToday },
    // AI spend
    { data: costToday }, { data: costYest },
    // marketplace
    { count: mktViewsToday }, { count: mktViewsYest },
    { count: mktProdToday }, { count: mktProdYest },
    { count: mktClicksToday }, { count: mktClicksYest },
    // alerts
    { data: pendingPay },
    { data: expiringTrials },
    { data: panicBots },
    { data: linkedBots },
    { data: recentMsgBiz },
  ] = await Promise.all([
    countIn('messages', todayStart, nowIso),
    countIn('messages', yesterdayStart, todayStart),
    countIn('messages', yesterdayStart, yesterdaySameTime),
    countIn('orders', todayStart, nowIso),
    countIn('orders', yesterdayStart, todayStart),
    sb.from('orders').select('total, status').gte('created_at', todayStart).limit(1000),
    sb.from('orders').select('total, status').gte('created_at', yesterdayStart).lt('created_at', todayStart).limit(1000),
    countIn('customers', todayStart, nowIso),
    countIn('customers', yesterdayStart, todayStart),
    countIn('search_logs', todayStart, nowIso),
    countIn('search_logs', yesterdayStart, todayStart),
    countIn('businesses', todayStart, nowIso),
    countIn('businesses', yesterdayStart, todayStart),
    countIn('search_logs', todayStart, nowIso, q => q.eq('results_count', 0)),
    sb.from('llm_call_log').select('total_cost_usd').gte('created_at', todayStart).limit(10000),
    sb.from('llm_call_log').select('total_cost_usd').gte('created_at', yesterdayStart).lt('created_at', todayStart).limit(10000),
    countIn('market_events', todayStart, nowIso, q => q.eq('event_type', 'view_market')),
    countIn('market_events', yesterdayStart, todayStart, q => q.eq('event_type', 'view_market')),
    countIn('market_events', todayStart, nowIso, q => q.eq('event_type', 'view_product')),
    countIn('market_events', yesterdayStart, todayStart, q => q.eq('event_type', 'view_product')),
    countIn('market_events', todayStart, nowIso, q => q.eq('event_type', 'click_chat')),
    countIn('market_events', yesterdayStart, todayStart, q => q.eq('event_type', 'click_chat')),
    sb.from('businesses').select('id, name').eq('subscription_status', 'pending_review').limit(20),
    sb.from('businesses').select('id, name, trial_ends_at')
      .eq('subscription_status', 'trial').not('trial_ends_at', 'is', null)
      .gt('trial_ends_at', nowIso).lt('trial_ends_at', in5days).limit(20),
    // Only currently-active businesses — a cancelled/expired tenant with a
    // stale panic flag isn't a live incident and shouldn't page anyone.
    sb.from('businesses').select('id, name, telegram_bot_username').eq('panic_mode', true).eq('subscription_status', 'active').limit(20),
    sb.from('businesses').select('id, name').not('telegram_bot_token_enc', 'is', null).limit(200),
    // one grouped-ish fetch: business_ids with any message in 48h (distinct via JS)
    sb.from('messages').select('business_id').gte('created_at', twoDaysAgo).limit(5000),
  ]);

  const sumPaid = rows => (rows || [])
    .filter(o => PAID.includes((o.status || '').toLowerCase()))
    .reduce((s, o) => s + Number(o.total || 0), 0);
  const sumCost = rows => Math.round((rows || []).reduce((s, r) => s + Number(r.total_cost_usd || 0), 0) * 100) / 100;

  const today = {
    messages: msgsToday || 0,
    orders: ordersToday || 0,
    revenue_etb: sumPaid(revToday),
    new_customers: custToday || 0,
    searches: searchToday || 0,
    signups: signupsToday || 0,
    market_views: mktViewsToday || 0,
    product_views: mktProdToday || 0,
    order_clicks: mktClicksToday || 0,
    ai_cost_usd: sumCost(costToday),
  };
  const yesterday = {
    messages: msgsYest || 0,
    orders: ordersYest || 0,
    revenue_etb: sumPaid(revYest),
    new_customers: custYest || 0,
    searches: searchYest || 0,
    signups: signupsYest || 0,
    market_views: mktViewsYest || 0,
    product_views: mktProdYest || 0,
    order_clicks: mktClicksYest || 0,
    ai_cost_usd: sumCost(costYest),
  };

  // Webhook success rate (1h) — from real delivery outcomes (webhook_events),
  // not the "no messages in 48h" proxy. Only custom-bot deliveries are logged
  // (see webhookHealth.js) — a small sample size is treated as inconclusive
  // rather than falsely triggering the banner.
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const { data: recentWebhooks } = await sb.from('webhook_events')
    .select('delivery_status').gte('created_at', oneHourAgo).limit(2000);
  const webhookTotal = (recentWebhooks || []).length;
  const webhookOk = (recentWebhooks || []).filter(w => w.delivery_status === 'success').length;
  const webhookSuccessRate1h = webhookTotal > 0 ? Math.round((webhookOk / webhookTotal) * 100) : null;

  // ── Platform status: scream only when something is actually broken ──────
  const msgDropPct = (msgsYestSoFar || 0) > 0
    ? Math.round((1 - (msgsToday || 0) / msgsYestSoFar) * 100)
    : 0;
  const aiSilent = (msgsToday || 0) > 0 && sumCost(costToday) === 0;
  const statusReasons = [];
  if (msgDropPct > 50) statusReasons.push(`Messages down ${msgDropPct}% vs same time yesterday`);
  if (aiSilent) statusReasons.push(`Zero AI cost today despite ${msgsToday} message${msgsToday === 1 ? '' : 's'} — check the LLM pipeline`);
  // Require a minimum sample so a quiet hour with 2 webhooks doesn't false-alarm.
  if (webhookSuccessRate1h != null && webhookTotal >= 10 && webhookSuccessRate1h < 90) {
    statusReasons.push(`Webhook success rate ${webhookSuccessRate1h}% in the last hour (${webhookOk}/${webhookTotal}) — check Connected Bots`);
  }
  const status = statusReasons.length ? 'red' : 'ok';

  // ── Alerts — each carries structured business targets for action buttons,
  // never a name for a business that no longer exists. ──────────────────────
  const alerts = [];
  if (pendingPay?.length) {
    alerts.push({
      severity: 'red', icon: '💳', type: 'pending_payment', tab: 'overview',
      summary: `${pendingPay.length} payment${pendingPay.length > 1 ? 's' : ''} waiting for review`,
      businesses: pendingPay.slice(0, 5).map(b => ({ id: b.id, name: b.name })),
    });
  }
  if (panicBots?.length) {
    alerts.push({
      severity: 'red', icon: '🔴', type: 'panic_mode', tab: 'businesses',
      summary: `Panic mode ON — AI replies paused`,
      businesses: panicBots.slice(0, 5).map(b => ({ id: b.id, name: b.name, telegram_bot_username: b.telegram_bot_username })),
    });
  }
  // Silent linked bots: have a bot, but not a single message in 48h.
  const activeBizIds = new Set((recentMsgBiz || []).map(m => m.business_id));
  const silent = (linkedBots || []).filter(b => !activeBizIds.has(b.id));
  if (silent.length) {
    alerts.push({
      severity: 'amber', icon: '🔇', type: 'silent_bot', tab: 'bots',
      summary: `${silent.length} linked bot${silent.length > 1 ? 's' : ''} with no messages in 48h`,
      businesses: silent.slice(0, 5).map(b => ({ id: b.id, name: b.name })),
    });
  }
  if (expiringTrials?.length) {
    alerts.push({
      severity: 'amber', icon: '⏳', type: 'expiring_trial', tab: 'businesses',
      summary: `${expiringTrials.length} trial${expiringTrials.length > 1 ? 's' : ''} expiring within 5 days`,
      businesses: expiringTrials.slice(0, 5).map(b => ({ id: b.id, name: b.name })),
    });
  }
  if ((zeroToday || 0) >= 3) {
    alerts.push({
      severity: 'amber', icon: '🔍', type: 'search_gap', tab: 'overview',
      summary: `${zeroToday} searches today found nothing — recruitment gaps (see Search Analytics)`,
      businesses: [],
    });
  }

  // ── Leak funnel: Signup → Searchable → Surfaced → Messaged → Ordered ────
  // Replaces the old raw event feed — one number per stage, one flagged leak,
  // instead of 30 individually uninterpretable rows.
  const funnel = await businessLeakFunnel({ days: 30 }).catch(() => null);

  // Vanity metrics (AI cost, market/product views, most-wanted) are noise at
  // low volume and create false confidence — only compute/show past 100 msgs/day.
  const mostWanted = (msgsToday || 0) > 100 ? await hotProducts({ days: 7, limit: 3 }).catch(() => []) : [];

  return NextResponse.json({ status, statusReasons, alerts, today, yesterday, funnel, mostWanted, webhookSuccessRate1h });
}
