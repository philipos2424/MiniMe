/**
 * GET /api/admin/pulse — master-dashboard data: what's happening right now.
 *
 * One call returns:
 *  - alerts[]: things that need the admin's attention (pending payments,
 *    trials expiring, panic-mode bots, silent linked bots, zero-result spike)
 *  - today / yesterday: EAT-day counts for messages, orders, revenue,
 *    new customers, searches, signups
 *  - feed[]: last 30 platform events merged from orders, signups, customers,
 *    search clicks and searches — text is built server-side.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';

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

  const countIn = (table, from, to, extra) => {
    let q = sb.from(table).select('id', { count: 'exact', head: true })
      .gte('created_at', from).lt('created_at', to);
    if (extra) q = extra(q);
    return q;
  };

  const [
    // today vs yesterday
    { count: msgsToday }, { count: msgsYest },
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
    { data: feedMarket },
    // alerts
    { data: pendingPay },
    { data: expiringTrials },
    { data: panicBots },
    { data: linkedBots },
    { data: recentMsgBiz },
    // feed
    { data: feedSignups },
    { data: feedOrders },
    { data: feedCustomers },
    { data: feedReferrals },
    { data: feedSearches },
  ] = await Promise.all([
    countIn('messages', todayStart, nowIso),
    countIn('messages', yesterdayStart, todayStart),
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
    sb.from('market_events').select('event_type, business_id, created_at')
      .in('event_type', ['view_product', 'click_chat'])
      .order('created_at', { ascending: false }).limit(10),
    sb.from('businesses').select('id, name').eq('subscription_status', 'pending_review').limit(20),
    sb.from('businesses').select('id, name, trial_ends_at')
      .eq('subscription_status', 'trial').not('trial_ends_at', 'is', null)
      .gt('trial_ends_at', nowIso).lt('trial_ends_at', in5days).limit(20),
    sb.from('businesses').select('id, name').eq('panic_mode', true).limit(20),
    sb.from('businesses').select('id, name').not('telegram_bot_token_enc', 'is', null).limit(200),
    // one grouped-ish fetch: business_ids with any message in 48h (distinct via JS)
    sb.from('messages').select('business_id').gte('created_at', twoDaysAgo).limit(5000),
    sb.from('businesses').select('id, name, created_at').order('created_at', { ascending: false }).limit(15),
    sb.from('orders').select('business_id, total, currency, status, created_at').order('created_at', { ascending: false }).limit(15),
    sb.from('customers').select('business_id, created_at').order('created_at', { ascending: false }).limit(15),
    sb.from('search_referrals').select('business_id, created_at').order('created_at', { ascending: false }).limit(15),
    sb.from('search_logs').select('raw_query, results_count, created_at').order('created_at', { ascending: false }).limit(15),
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

  // ── Alerts ──────────────────────────────────────────────────────────────
  const alerts = [];
  if (pendingPay?.length) {
    alerts.push({
      severity: 'red', icon: '💳', tab: 'overview',
      text: `${pendingPay.length} payment${pendingPay.length > 1 ? 's' : ''} waiting for review — ${pendingPay.slice(0, 3).map(b => b.name).join(', ')}${pendingPay.length > 3 ? '…' : ''}`,
    });
  }
  if (panicBots?.length) {
    alerts.push({
      severity: 'red', icon: '🔴', tab: 'businesses',
      text: `Panic mode ON for ${panicBots.map(b => b.name).join(', ')} — AI replies are paused`,
    });
  }
  // Silent linked bots: have a bot, but not a single message in 48h.
  const activeBizIds = new Set((recentMsgBiz || []).map(m => m.business_id));
  const silent = (linkedBots || []).filter(b => !activeBizIds.has(b.id));
  if (silent.length) {
    alerts.push({
      severity: 'amber', icon: '🔇', tab: 'bots',
      text: `${silent.length} linked bot${silent.length > 1 ? 's' : ''} with no messages in 48h — ${silent.slice(0, 3).map(b => b.name).join(', ')}${silent.length > 3 ? '…' : ''} (check webhooks)`,
    });
  }
  if (expiringTrials?.length) {
    alerts.push({
      severity: 'amber', icon: '⏳', tab: 'businesses',
      text: `${expiringTrials.length} trial${expiringTrials.length > 1 ? 's' : ''} expiring within 5 days — ${expiringTrials.slice(0, 3).map(b => b.name).join(', ')}${expiringTrials.length > 3 ? '…' : ''}`,
    });
  }
  if ((zeroToday || 0) >= 3) {
    alerts.push({
      severity: 'amber', icon: '🔍', tab: 'overview',
      text: `${zeroToday} searches today found nothing — recruitment gaps (see Search Analytics)`,
    });
  }

  // ── Activity feed ────────────────────────────────────────────────────────
  const bizIds = [...new Set([
    ...(feedOrders || []).map(o => o.business_id),
    ...(feedCustomers || []).map(c => c.business_id),
    ...(feedReferrals || []).map(r => r.business_id),
    ...(feedMarket || []).map(m => m.business_id),
  ].filter(Boolean))];
  let names = {};
  if (bizIds.length) {
    const { data: bizRows } = await sb.from('businesses').select('id, name').in('id', bizIds);
    names = Object.fromEntries((bizRows || []).map(b => [b.id, b.name]));
  }
  const nameOf = id => names[id] || 'Unknown business';

  const feed = [
    ...(feedSignups || []).map(b => ({
      type: 'signup', at: b.created_at,
      text: `🆕 New business signed up — ${b.name}`,
    })),
    ...(feedOrders || []).map(o => ({
      type: 'order', at: o.created_at,
      text: `🛒 Order at ${nameOf(o.business_id)} — ${Number(o.total || 0).toLocaleString()} ${o.currency || 'ETB'} (${o.status || 'new'})`,
    })),
    ...(feedCustomers || []).map(c => ({
      type: 'customer', at: c.created_at,
      text: `👤 New customer at ${nameOf(c.business_id)}`,
    })),
    ...(feedReferrals || []).map(r => ({
      type: 'referral', at: r.created_at,
      text: `🔎 Search click → ${nameOf(r.business_id)}`,
    })),
    ...(feedMarket || []).map(m => ({
      type: 'market', at: m.created_at,
      text: m.event_type === 'click_chat'
        ? `🛍️ Market: order click → ${nameOf(m.business_id)}`
        : `🛍️ Market: product viewed at ${nameOf(m.business_id)}`,
    })),
    ...(feedSearches || []).map(l => ({
      type: l.results_count === 0 ? 'search_miss' : 'search', at: l.created_at,
      text: l.results_count === 0
        ? `❌ Search found nothing — "${(l.raw_query || '').slice(0, 40)}"`
        : `🔍 Search — "${(l.raw_query || '').slice(0, 40)}" (${l.results_count} result${l.results_count === 1 ? '' : 's'})`,
    })),
  ]
    .filter(e => e.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 30);

  return NextResponse.json({ alerts, today, yesterday, feed });
}
