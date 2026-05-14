/**
 * GET /api/admin/overview — platform-wide stats for the admin dashboard.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [
    { count: totalBusinesses },
    { count: linkedBusinesses },
    { count: activeWeek },
    { count: signupsThisWeek },
    { count: messagesWeek },
    { count: aiMessagesWeek },
    { count: ordersWeek },
    { data: paidOrders },
    { count: jobsActive },
    { count: customersTotal },
    { count: lessonsThisWeek },
    { data: recentMessages },
    { data: recentSignups },
    { data: topBizMsgs },
  ] = await Promise.all([
    sb.from('businesses').select('id', { count: 'exact', head: true }),
    sb.from('businesses').select('id', { count: 'exact', head: true }).not('telegram_bot_token_enc', 'is', null),
    sb.from('businesses').select('id', { count: 'exact', head: true }).gte('updated_at', weekAgo),
    sb.from('businesses').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo).eq('is_ai_generated', true).eq('direction', 'outbound'),
    sb.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('orders').select('total, currency, status').gte('created_at', weekAgo).limit(1000),
    sb.from('jobs').select('id', { count: 'exact', head: true }).in('status', ['draft', 'active', 'awaiting_approval', 'blocked']),
    sb.from('customers').select('id', { count: 'exact', head: true }),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('tag', 'auto-learned').gte('created_at', weekAgo),
    // Daily message trend (last 7 days — keep created_at for bucketing in JS)
    sb.from('messages').select('created_at').gte('created_at', weekAgo).limit(50000),
    // Daily signups trend (last 30 days)
    sb.from('businesses').select('created_at').gte('created_at', monthAgo).limit(500),
    // Top businesses by message count (for per-row stat, we get business_id)
    sb.from('messages').select('business_id').gte('created_at', weekAgo).limit(50000),
  ]);

  const revenueETB = (paidOrders || [])
    .filter(o => ['paid', 'fulfilled', 'completed'].includes((o.status || '').toLowerCase()) && (o.currency || 'ETB') === 'ETB')
    .reduce((s, o) => s + (Number(o.total) || 0), 0);

  // Subscription breakdown
  const { data: bizPlans } = await sb.from('businesses').select('id, name, subscription_status, subscription_plan, trial_ends_at, plan_tier');
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

  // Daily message counts (last 7 days)
  const msgsByDay = {};
  for (const m of recentMessages || []) {
    const day = m.created_at?.slice(0, 10);
    if (day) msgsByDay[day] = (msgsByDay[day] || 0) + 1;
  }
  const messageTrend = last7Days().map(d => ({ date: d, count: msgsByDay[d] || 0 }));

  // Daily signup counts (last 30 days)
  const signupsByDay = {};
  for (const b of recentSignups || []) {
    const day = b.created_at?.slice(0, 10);
    if (day) signupsByDay[day] = (signupsByDay[day] || 0) + 1;
  }
  const signupTrend = last30Days().map(d => ({ date: d, count: signupsByDay[d] || 0 }));

  // Top 5 businesses by message volume this week
  const msgCountByBiz = {};
  for (const m of topBizMsgs || []) {
    msgCountByBiz[m.business_id] = (msgCountByBiz[m.business_id] || 0) + 1;
  }
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
      active_week: activeWeek || 0,
      signups_week: signupsThisWeek || 0,
      messages_week: messagesWeek || 0,
      ai_messages_week: aiMessagesWeek || 0,
      ai_rate_pct: aiRate,
      orders_week: ordersWeek || 0,
      revenue_etb_week: revenueETB,
      jobs_active: jobsActive || 0,
      customers_total: customersTotal || 0,
      lessons_week: lessonsThisWeek || 0,
      trials_expiring_soon: trialsExpiringSoon,
    },
    plans: planBreakdown,
    statuses: statusBreakdown,
    pending_payments: pendingPayments || [],
    message_trend: messageTrend,
    signup_trend: signupTrend,
    top_businesses: topBusinesses,
  });
}

function last7Days() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });
}

function last30Days() {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });
}
