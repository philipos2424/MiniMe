/**
 * GET /api/admin/overview — platform-wide stats for the admin dashboard.
 *
 * Row-level aggregations go through fetchAllRows: Supabase caps every
 * response at 1000 rows, so a plain .limit(50000) silently truncated the
 * trends, GMV and top-business numbers once the platform got busy.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAID = ['paid', 'fulfilled', 'completed'];

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [
    { count: totalBusinesses },
    { count: linkedBusinesses },
    { count: connectedBusinesses },
    { count: signupsThisWeek },
    { count: signupsPrevWeek },
    { count: messagesWeek },
    { count: messagesPrevWeek },
    { count: aiMessagesWeek },
    { count: ordersWeek },
    { count: ordersPrevWeek },
    { count: jobsActive },
    { count: customersTotal },
    { count: customersNewWeek },
    { count: customersNewPrevWeek },
    { count: lessonsThisWeek },
    // Raw rows for JS aggregation — all paginated past the 1000-row cap.
    { data: weekMessages },
    { data: prevWeekMsgBiz },
    { data: weekOrders },
    { data: prevWeekOrders },
    { data: recentSignups },
    { data: monthMessages },
  ] = await Promise.all([
    sb.from('businesses').select('id', { count: 'exact', head: true }),
    sb.from('businesses').select('id', { count: 'exact', head: true }).not('telegram_bot_token_enc', 'is', null),
    // "Connected" must match the businesses list: finished onboarding AND has
    // either a custom bot or a shop_code (shared-bot mode). Counting only
    // custom-bot tokens made shared-mode shops look disconnected up here.
    sb.from('businesses').select('id', { count: 'exact', head: true })
      .eq('onboarding_completed', true)
      .or('telegram_bot_token_enc.not.is.null,shop_code.not.is.null'),
    sb.from('businesses').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('businesses').select('id', { count: 'exact', head: true }).gte('created_at', twoWeeksAgo).lt('created_at', weekAgo),
    sb.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', twoWeeksAgo).lt('created_at', weekAgo),
    sb.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo).eq('is_ai_generated', true).eq('direction', 'outbound'),
    sb.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', twoWeeksAgo).lt('created_at', weekAgo),
    sb.from('jobs').select('id', { count: 'exact', head: true }).in('status', ['draft', 'active', 'awaiting_approval', 'blocked']),
    sb.from('customers').select('id', { count: 'exact', head: true }),
    sb.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('customers').select('id', { count: 'exact', head: true }).gte('created_at', twoWeeksAgo).lt('created_at', weekAgo),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('tag', 'auto-learned').gte('created_at', weekAgo),
    // One fetch feeds the daily trend, top businesses AND the active count.
    fetchAllRows(() => sb.from('messages').select('created_at, business_id').gte('created_at', weekAgo).order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('messages').select('business_id').gte('created_at', twoWeeksAgo).lt('created_at', weekAgo).order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('orders').select('total, currency, status').gte('created_at', weekAgo).order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('orders').select('total, currency, status').gte('created_at', twoWeeksAgo).lt('created_at', weekAgo).order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('businesses').select('created_at').gte('created_at', monthAgo).order('created_at', { ascending: true })),
    // 30-day active businesses (mirrors activeBizWeek, wider window).
    fetchAllRows(() => sb.from('messages').select('business_id').gte('created_at', monthAgo).order('created_at', { ascending: true })),
  ]);

  // Platform MAU: distinct end-user Telegram ids active in 30d, unioned across
  // messaging customers + searchers + Market users. Kept out of the Promise.all
  // above because it chains dependent queries (customer_id → telegram_id).
  const mauIds = new Set();
  try {
    const { data: activeCustomerRows } = await fetchAllRows(() => sb.from('messages')
      .select('customer_id').eq('direction', 'inbound').gte('created_at', monthAgo)
      .not('customer_id', 'is', null).order('created_at', { ascending: true }));
    const custIds = [...new Set((activeCustomerRows || []).map(m => m.customer_id))];
    for (let i = 0; i < custIds.length; i += 500) {
      const { data: custs } = await sb.from('customers').select('telegram_id')
        .in('id', custIds.slice(i, i + 500)).not('telegram_id', 'is', null);
      for (const c of custs || []) mauIds.add(String(c.telegram_id));
    }
    const { data: searchers } = await fetchAllRows(() => sb.from('search_logs')
      .select('searcher_telegram_id').gte('created_at', monthAgo)
      .not('searcher_telegram_id', 'is', null).order('created_at', { ascending: true }));
    for (const s of searchers || []) mauIds.add(String(s.searcher_telegram_id));
    const { data: marketUsers } = await fetchAllRows(() => sb.from('market_events')
      .select('tg_user_id').gte('created_at', monthAgo)
      .not('tg_user_id', 'is', null).order('created_at', { ascending: true }));
    for (const m of marketUsers || []) mauIds.add(String(m.tg_user_id));
  } catch (e) { console.warn('[overview] platform MAU failed:', e.message); }
  const platformMAU = mauIds.size;

  const activeBizMonth = new Set();
  for (const m of monthMessages || []) if (m.business_id) activeBizMonth.add(m.business_id);

  const sumPaidETB = orders => (orders || [])
    .filter(o => PAID.includes((o.status || '').toLowerCase()) && (o.currency || 'ETB') === 'ETB')
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  const revenueETB = sumPaidETB(weekOrders);
  const revenueETBPrev = sumPaidETB(prevWeekOrders);

  // Subscription breakdown
  const { data: bizPlans } = await fetchAllRows(() =>
    sb.from('businesses').select('id, name, subscription_status, subscription_plan, trial_ends_at, plan_tier').order('created_at', { ascending: true }));
  const planBreakdown = {};
  const statusBreakdown = {};
  let trialsExpiringSoon = 0;
  const fiveDaysFromNow = Date.now() + 5 * 86400000;
  const bizNameMap = {};
  for (const b of bizPlans || []) {
    bizNameMap[b.id] = b.name;
    const plan = b.plan_tier || b.subscription_plan || 'free';
    planBreakdown[plan] = (planBreakdown[plan] || 0) + 1;
    const status = b.subscription_status || 'unknown';
    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    if (b.subscription_status === 'trial' && b.trial_ends_at && new Date(b.trial_ends_at).getTime() < fiveDaysFromNow) {
      trialsExpiringSoon++;
    }
  }

  // Daily message counts (last 7 days, EAT days) + per-business volume +
  // "active" = businesses that actually exchanged messages this week.
  // (The old metric counted businesses.updated_at, which any admin edit bumps.)
  const msgsByDay = {};
  const msgCountByBiz = {};
  const activeBizWeek = new Set();
  for (const m of weekMessages || []) {
    const day = dayKeyEAT(m.created_at);
    if (day) msgsByDay[day] = (msgsByDay[day] || 0) + 1;
    if (m.business_id) {
      msgCountByBiz[m.business_id] = (msgCountByBiz[m.business_id] || 0) + 1;
      activeBizWeek.add(m.business_id);
    }
  }
  const messageTrend = lastNDaysEAT(7).map(d => ({ date: d, count: msgsByDay[d] || 0 }));

  const activeBizPrevWeek = new Set();
  for (const m of prevWeekMsgBiz || []) if (m.business_id) activeBizPrevWeek.add(m.business_id);

  // Daily signup counts (last 30 days)
  const signupsByDay = {};
  for (const b of recentSignups || []) {
    const day = dayKeyEAT(b.created_at);
    if (day) signupsByDay[day] = (signupsByDay[day] || 0) + 1;
  }
  const signupTrend = lastNDaysEAT(30).map(d => ({ date: d, count: signupsByDay[d] || 0 }));

  // Top 5 businesses by message volume this week
  const topBusinesses = Object.entries(msgCountByBiz)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ id, name: bizNameMap[id] || id, messages_week: count }));

  // AI automation rate
  const aiRate = (messagesWeek || 0) > 0 ? Math.round(((aiMessagesWeek || 0) / (messagesWeek || 1)) * 100) : 0;

  // Pending payments (manual subscription proofs awaiting review)
  const { data: pendingPayments } = await sb.from('businesses')
    .select('id, name, plan_tier, subscription_status, subscription_expires_at, payment_method, payment_proof_url, payment_ref, payment_notes, payment_verified, created_at')
    .or('subscription_status.eq.pending_review,and(payment_proof_url.not.is.null,payment_verified.eq.false)')
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    totals: {
      businesses: totalBusinesses || 0,
      linked: linkedBusinesses || 0,
      connected: connectedBusinesses || 0,
      active_week: activeBizWeek.size,
      active_month: activeBizMonth.size,
      platform_mau: platformMAU,
      signups_week: signupsThisWeek || 0,
      messages_week: messagesWeek || 0,
      ai_messages_week: aiMessagesWeek || 0,
      ai_rate_pct: aiRate,
      orders_week: ordersWeek || 0,
      revenue_etb_week: revenueETB,
      jobs_active: jobsActive || 0,
      customers_total: customersTotal || 0,
      customers_new_week: customersNewWeek || 0,
      lessons_week: lessonsThisWeek || 0,
      trials_expiring_soon: trialsExpiringSoon,
    },
    // Same metrics for the 7 days before, so the UI can show week-over-week.
    prev_totals: {
      active_week: activeBizPrevWeek.size,
      signups_week: signupsPrevWeek || 0,
      messages_week: messagesPrevWeek || 0,
      orders_week: ordersPrevWeek || 0,
      revenue_etb_week: revenueETBPrev,
      customers_new_week: customersNewPrevWeek || 0,
    },
    plans: planBreakdown,
    statuses: statusBreakdown,
    pending_payments: pendingPayments || [],
    message_trend: messageTrend,
    signup_trend: signupTrend,
    top_businesses: topBusinesses,
  });
}
