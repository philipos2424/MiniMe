/**
 * GET /api/admin/businesses — list every business with key stats
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: businesses } = await fetchAllRows(() => sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_username, telegram_bot_username, shop_code, bot_mode, onboarding_completed, plan_tier, subscription_status, subscription_plan, trial_ends_at, panic_mode, brain_mode, trust_level, created_at, updated_at, category')
    .order('created_at', { ascending: false }));

  if (!businesses?.length) return NextResponse.json({ businesses: [] });

  // Paginated: a plain .limit() is capped at 1000 rows by Supabase, which
  // silently zeroed out per-business stats for anything past the cap.
  const [
    { data: msgCounts },
    { data: orderCounts },
    { data: customerCounts },
  ] = await Promise.all([
    fetchAllRows(() => sb.from('messages').select('business_id').gte('created_at', weekAgo).order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('orders').select('business_id, total, status').gte('created_at', weekAgo).order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('customers').select('business_id').order('created_at', { ascending: true })),
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
