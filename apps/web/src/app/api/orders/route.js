/**
 * GET /api/orders — paginated order list for the Mini App.
 * Returns orders for the authenticated business, newest first.
 * Query params: status (all|paid|pending_payment|fulfilled), limit (default 30), offset (default 0)
 *
 * PATCH /api/orders — mark an order's status (paid / fulfilled / cancelled).
 * Body: { id, status }
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolve(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findBusinessForUser(tg.id) : null;
}

export async function GET(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'all';
  const limit  = Math.min(parseInt(searchParams.get('limit')  || '30', 10), 100);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const sb = supabase();
  let q = sb.from('orders')
    .select('id, status, total, currency, items, created_at, paid_at, fulfilled_at, checkout_url, payment_method, owner_note, customers(id, name, telegram_username, telegram_id)')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status !== 'all') q = q.eq('status', status);

  const { data: orders, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // EAT timezone (UTC+3) for "today" boundary
  const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
  const nowEAT = new Date(Date.now() + EAT_OFFSET_MS);
  nowEAT.setUTCHours(0, 0, 0, 0);
  const startOfDay = new Date(nowEAT.getTime() - EAT_OFFSET_MS);

  // Revenue summary for today
  const { data: todayPaid } = await sb.from('orders')
    .select('total, currency')
    .eq('business_id', business.id)
    .eq('status', 'paid')
    .gte('paid_at', startOfDay.toISOString());

  const revenueToday = (todayPaid || []).reduce((s, o) => s + Number(o.total || 0), 0);
  const ordersToday  = todayPaid?.length || 0;
  const currency     = todayPaid?.[0]?.currency || orders?.[0]?.currency || 'ETB';

  return NextResponse.json({
    orders: (orders || []).map(o => ({
      id: o.id,
      status: o.status,
      total: Number(o.total || 0),
      currency: o.currency || 'ETB',
      items: o.items || [],
      created_at: o.created_at,
      paid_at: o.paid_at,
      fulfilled_at: o.fulfilled_at,
      checkout_url: o.checkout_url,
      payment_method: o.payment_method,
      owner_note: o.owner_note,
      customer_name: o.customers?.name || (o.customers?.telegram_username ? `@${o.customers.telegram_username}` : 'Customer'),
      customer_telegram_id: o.customers?.telegram_id || null,
    })),
    revenue_today: revenueToday,
    orders_today: ordersToday,
    currency,
  });
}

export async function PATCH(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { id, status } = body;
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });

  const ALLOWED = ['paid', 'fulfilled', 'cancelled'];
  if (!ALLOWED.includes(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });

  const sb = supabase();

  // Verify this order belongs to this business
  const { data: existing } = await sb.from('orders').select('id, status').eq('id', id).eq('business_id', business.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updates = { status };
  if (status === 'paid' && !existing.paid_at)           updates.paid_at = new Date().toISOString();
  if (status === 'fulfilled' && !existing.fulfilled_at) updates.fulfilled_at = new Date().toISOString();

  const { data: updated, error } = await sb.from('orders').update(updates).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, order: updated });
}
