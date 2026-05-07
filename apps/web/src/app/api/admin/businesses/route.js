/**
 * GET /api/admin/businesses — list every business with key stats
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

  const { data: businesses } = await sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, telegram_bot_username, plan_tier, subscription_status, subscription_plan, trial_ends_at, panic_mode, brain_mode, trust_level, created_at, updated_at, category')
    .order('created_at', { ascending: false });

  if (!businesses?.length) return NextResponse.json({ businesses: [] });

  const ids = businesses.map(b => b.id);
  const [
    { data: msgCounts },
    { data: orderCounts },
    { data: customerCounts },
  ] = await Promise.all([
    sb.from('messages').select('business_id').in('business_id', ids).gte('created_at', weekAgo).limit(20000),
    sb.from('orders').select('business_id, total, status').in('business_id', ids).gte('created_at', weekAgo).limit(2000),
    sb.from('customers').select('business_id').in('business_id', ids).limit(20000),
  ]);

  const msgsByBiz = {}, ordersByBiz = {}, paidByBiz = {}, customersByBiz = {};
  for (const m of msgCounts || []) msgsByBiz[m.business_id] = (msgsByBiz[m.business_id] || 0) + 1;
  for (const o of orderCounts || []) {
    ordersByBiz[o.business_id] = (ordersByBiz[o.business_id] || 0) + 1;
    if (['paid', 'fulfilled', 'completed'].includes((o.status || '').toLowerCase())) {
      paidByBiz[o.business_id] = (paidByBiz[o.business_id] || 0) + Number(o.total || 0);
    }
  }
  for (const c of customerCounts || []) customersByBiz[c.business_id] = (customersByBiz[c.business_id] || 0) + 1;

  const enriched = businesses.map(b => ({
    ...b,
    stats: {
      messages_week: msgsByBiz[b.id] || 0,
      orders_week: ordersByBiz[b.id] || 0,
      revenue_week: paidByBiz[b.id] || 0,
      customers_total: customersByBiz[b.id] || 0,
    },
  }));

  return NextResponse.json({ businesses: enriched });
}
