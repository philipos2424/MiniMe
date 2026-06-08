/**
 * GET    /api/orders     — paginated order list
 * POST   /api/orders     — manually create an order (walk-in, phone orders)
 * PATCH  /api/orders     — update order status
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';
import { str, name as nameVal, num, price, arr, oneOf, ValidationError, validationResponse } from '../../../lib/server/sanitize';
import { audit } from '../../../lib/server/audit';

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
    .select('id, status, total, currency, items, created_at, paid_at, fulfilled_at, checkout_url, payment_method, owner_note, meta, customers(id, name, telegram_username, telegram_id)')
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
      meta: o.meta || null,
      customer_name: o.customers?.name || (o.customers?.telegram_username ? `@${o.customers.telegram_username}` : 'Customer'),
      customer_telegram_id: o.customers?.telegram_id || null,
    })),
    revenue_today: revenueToday,
    orders_today: ordersToday,
    currency,
  });
}

export async function POST(request) {
  // Manually create an order — for walk-in, phone, or offline customers
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  // ── Input validation ──────────────────────────────────────────────────────
  let customer_name, customer_phone, items, total, currency, status, owner_note;
  try {
    customer_name  = nameVal(body.customer_name, { field: 'customer_name', min: 0, max: 100, required: false }) || null;
    customer_phone = str(body.customer_phone, { field: 'customer_phone', max: 30, required: false }) || null;
    items          = arr(body.items, { field: 'items', minLen: 1, maxLen: 50, required: true });
    total          = price(body.total, { field: 'total', min: 0, max: 10_000_000 });
    currency       = oneOf(body.currency || 'ETB', ['ETB', 'USD', 'EUR', 'GBP'], { field: 'currency' }) || 'ETB';
    status         = oneOf(body.status, ['paid', 'pending_payment', 'fulfilled'], { field: 'status', required: false }) || 'paid';
    owner_note     = str(body.owner_note, { field: 'owner_note', max: 1000, required: false });

    // Validate each item
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      items[i] = {
        name:  nameVal(it.name, { field: `items[${i}].name`, max: 200, required: true }),
        qty:   num(it.qty || 1, { field: `items[${i}].qty`, min: 1, max: 10000, integer: true }),
        price: price(it.price, { field: `items[${i}].price`, min: 0 }),
      };
    }
    if (total === null) throw new ValidationError('total', 'is required');
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const sb = supabase();

  // Find or create customer by name/phone
  let customerId = null;
  if (customer_name || customer_phone) {
    // Try to find existing customer
    let q = sb.from('customers').select('id').eq('business_id', business.id);
    if (customer_phone) q = q.eq('phone', customer_phone.trim());
    else q = q.ilike('name', customer_name.trim());
    const { data: existing } = await q.maybeSingle();

    if (existing) {
      customerId = existing.id;
    } else {
      // Create a new customer record
      const { data: newCust } = await sb.from('customers').insert({
        business_id: business.id,
        name: customer_name?.trim() || 'Walk-in Customer',
        phone: customer_phone?.trim() || null,
        platform: 'manual',
        phone_verified: !!customer_phone,
      }).select('id').single();
      customerId = newCust?.id || null;
    }
  }

  const orderStatus = ['paid', 'pending_payment', 'fulfilled'].includes(status) ? status : 'paid';
  const now = new Date().toISOString();

  const { data: order, error } = await sb.from('orders').insert({
    business_id: business.id,
    customer_id: customerId,
    items: items.map(i => ({ name: i.name, qty: i.qty || 1, price: i.price || null })),
    total: Number(total),
    currency: currency || business.currency || 'ETB',
    status: orderStatus,
    payment_method: 'manual',
    owner_note: owner_note?.trim() || null,
    paid_at: orderStatus === 'paid' ? now : null,
    fulfilled_at: orderStatus === 'fulfilled' ? now : null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Award loyalty points if customer exists
  if (customerId && orderStatus === 'paid') {
    const pts = 10 + (Number(total) >= 500 ? 20 : 0);
    await sb.from('customers')
      .update({
        total_orders: sb.rpc('increment', { row_id: customerId, table_name: 'customers', column_name: 'total_orders', amount: 1 }).then(() => {}),
        loyalty_points: (await sb.from('customers').select('loyalty_points').eq('id', customerId).single()).data?.loyalty_points + pts || pts,
      })
      .eq('id', customerId)
      .catch(() => {});
  }

  return NextResponse.json({ ok: true, order });
}

export async function PATCH(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  let id, status, owner_note_patch;
  try {
    id     = str(body.id, { field: 'id', min: 1, max: 36, required: true });
    status = oneOf(body.status, ['paid', 'fulfilled', 'cancelled'], { field: 'status', required: true });
    owner_note_patch = str(body.owner_note, { field: 'owner_note', max: 1000, required: false });
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const sb = supabase();

  // Verify this order belongs to this business
  const { data: existing } = await sb.from('orders').select('id, status').eq('id', id).eq('business_id', business.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updates = { status };
  if (status === 'paid' && !existing.paid_at)           updates.paid_at = new Date().toISOString();
  if (status === 'fulfilled' && !existing.fulfilled_at) updates.fulfilled_at = new Date().toISOString();

  const { data: updated, error } = await sb.from('orders')
    .update(updates)
    .eq('id', id)
    .select('*, customers(id, name, telegram_id, whatsapp_id)')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify customer via Telegram when order is marked paid or fulfilled
  if ((status === 'paid' || status === 'fulfilled') && updated?.customers?.telegram_id) {
    try {
      const botToken = business.telegram_bot_token_enc
        ? (() => { try { const { decrypt } = require('../../../lib/server/crypto'); return decrypt(business.telegram_bot_token_enc); } catch { return null; } })()
        : null;
      if (botToken) {
        const custName = updated.customers.name || 'there';
        const itemList = Array.isArray(updated.items) && updated.items.length
          ? updated.items.map(i => `• ${i.qty || 1}x ${i.name || i.product || 'item'}`).join('\n')
          : null;
        const total = updated.total ? `${Number(updated.total).toLocaleString()} ${updated.currency || 'ETB'}` : null;

        let text;
        if (status === 'paid') {
          text = [
            `✅ *Payment confirmed, ${custName}!*`,
            itemList ? `\n${itemList}` : null,
            total ? `\nTotal: *${total}*` : null,
            `\nYour order is confirmed and being prepared. We'll let you know when it's ready! 📦`,
          ].filter(Boolean).join('');
        } else {
          text = [
            `🎉 *Your order is on its way, ${custName}!*`,
            itemList ? `\n${itemList}` : null,
            `\n${business.name} has fulfilled your order. Thank you for shopping with us! 🙏`,
          ].filter(Boolean).join('');
        }

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: updated.customers.telegram_id,
            text,
            parse_mode: 'Markdown',
          }),
          signal: AbortSignal.timeout(8000),
        }).catch(() => {}); // fire-and-forget — never block the response
      }
    } catch (e) {
      console.warn('[orders PATCH] customer notify failed:', e.message);
    }
  }

  // Audit trail for status changes
  const tgUser = parseTelegramUser(request.headers.get('x-telegram-init-data'));
  audit({
    business_id: business.id, actor_type: 'owner', actor_id: String(tgUser?.id || 'unknown'),
    action: 'order.status_changed', resource_type: 'order', resource_id: id,
    metadata: { old_status: existing.status, new_status: status },
    request,
  }).catch(() => {});

  return NextResponse.json({ ok: true, order: updated });
}
