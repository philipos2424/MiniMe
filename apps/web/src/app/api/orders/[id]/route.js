/**
 * GET /api/orders/[id] — single order detail for the order detail page.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { str, oneOf, ValidationError, validationResponse } from '../../../../lib/server/sanitize';

const DELIVERY_STATUSES = ['preparing', 'on_the_way', 'delivered', 'collected', 'returned', 'cancelled'];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  // Update order delivery status / notes
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const sb = supabase();
  const updates = {};

  try {
    if (body.delivery_status !== undefined) {
      updates.delivery_status = oneOf(body.delivery_status, DELIVERY_STATUSES, { field: 'delivery_status', required: false });
    }
    if (body.owner_note !== undefined) {
      updates.owner_note = str(body.owner_note, { field: 'owner_note', max: 2000, required: false }) || null;
    }
    if (body.tracking_info !== undefined) {
      updates.tracking_info = str(body.tracking_info, { field: 'tracking_info', max: 500, required: false }) || null;
    }
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const { data: order } = await sb.from('orders')
    .update(updates)
    .eq('id', params.id)
    .eq('business_id', business.id)
    .select()
    .single();

  return NextResponse.json({ ok: true, order });
}

export async function GET(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const { data: order } = await sb.from('orders')
    .select('*, customers(id, name, telegram_username, telegram_id, phone), checkout_url, chapa_tx_ref')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Find the conversation for this customer so we can link to it
  let conversation = null;
  if (order.customer_id) {
    const { data: conv } = await sb.from('conversations')
      .select('id')
      .eq('customer_id', order.customer_id)
      .eq('business_id', business.id)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    conversation = conv || null;
  }

  return NextResponse.json({ order, conversation });
}
