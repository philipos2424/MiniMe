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
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    { count: totalBusinesses },
    { count: linkedBusinesses },
    { count: activeWeek },
    { count: signupsThisWeek },
    { count: messagesWeek },
    { count: ordersWeek },
    { data: paidOrders },
    { count: jobsActive },
    { count: customersTotal },
    { count: lessonsThisWeek },
  ] = await Promise.all([
    sb.from('businesses').select('id', { count: 'exact', head: true }),
    sb.from('businesses').select('id', { count: 'exact', head: true }).not('telegram_bot_token_enc', 'is', null),
    sb.from('businesses').select('id', { count: 'exact', head: true }).gte('updated_at', weekAgo),
    sb.from('businesses').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    sb.from('orders').select('total, currency, status').gte('created_at', weekAgo).limit(1000),
    sb.from('jobs').select('id', { count: 'exact', head: true }).in('status', ['draft', 'active', 'awaiting_approval', 'blocked']),
    sb.from('customers').select('id', { count: 'exact', head: true }),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('tag', 'auto-learned').gte('created_at', weekAgo),
  ]);

  const revenueETB = (paidOrders || [])
    .filter(o => ['paid', 'fulfilled', 'completed'].includes((o.status || '').toLowerCase()) && (o.currency || 'ETB') === 'ETB')
    .reduce((s, o) => s + (Number(o.total) || 0), 0);

  // Subscription breakdown
  const { data: bizPlans } = await sb.from('businesses').select('subscription_status, subscription_plan, trial_ends_at, plan_tier');
  const planBreakdown = {};
  const statusBreakdown = {};
  let trialsExpiringSoon = 0;
  const fiveDaysFromNow = Date.now() + 5 * 86400000;
  for (const b of bizPlans || []) {
    const plan = b.plan_tier || b.subscription_plan || 'free';
    planBreakdown[plan] = (planBreakdown[plan] || 0) + 1;
    const status = b.subscription_status || 'unknown';
    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    if (b.subscription_status === 'trial' && b.trial_ends_at && new Date(b.trial_ends_at).getTime() < fiveDaysFromNow) {
      trialsExpiringSoon++;
    }
  }

  return NextResponse.json({
    totals: {
      businesses: totalBusinesses || 0,
      linked: linkedBusinesses || 0,
      active_week: activeWeek || 0,
      signups_week: signupsThisWeek || 0,
      messages_week: messagesWeek || 0,
      orders_week: ordersWeek || 0,
      revenue_etb_week: revenueETB,
      jobs_active: jobsActive || 0,
      customers_total: customersTotal || 0,
      lessons_week: lessonsThisWeek || 0,
      trials_expiring_soon: trialsExpiringSoon,
    },
    plans: planBreakdown,
    statuses: statusBreakdown,
  });
}
