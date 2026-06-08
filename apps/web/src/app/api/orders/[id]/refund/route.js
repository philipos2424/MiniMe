/**
 * POST /api/orders/[id]/refund
 * Body: { reason?: string }
 *
 * Calls the Chapa refund endpoint, updates the order status to 'refunded',
 * and DMs the customer a notification.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser, findById as findBusinessById } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { decrypt } from '../../../../../lib/server/crypto';
import { requireOwner } from '../../../../../lib/server/auth';
import { audit } from '../../../../../lib/server/audit';
import { str, ValidationError, validationResponse } from '../../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function sendTelegram(token, chatId, text) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8000),
  });
}

export async function POST(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!requireOwner(business, tg)) {
    return NextResponse.json({ error: 'forbidden', detail: 'Only the shop owner can issue refunds.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  let reason;
  try {
    reason = str(body.reason, { field: 'reason', max: 500, required: false }) || 'Refund requested by merchant';
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const sb = supabase();
  const { data: order } = await sb.from('orders')
    .select('*, customers(name, telegram_id)')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!['paid', 'fulfilled'].includes(order.status)) {
    return NextResponse.json({ error: 'not_refundable', detail: `Order status is '${order.status}'` }, { status: 400 });
  }
  if (order.status === 'refunded') {
    return NextResponse.json({ error: 'already_refunded' }, { status: 400 });
  }

  // ── Attempt Chapa refund if we have a tx_ref and key ──────────────────────
  let chapaRefunded = false;
  if (order.chapa_tx_ref && process.env.CHAPA_SECRET_KEY) {
    try {
      const r = await fetch(`https://api.chapa.co/v1/refund/${encodeURIComponent(order.chapa_tx_ref)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CHAPA_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(12000),
      });
      const j = await r.json().catch(() => ({}));
      // Chapa returns { status: 'success', ... } on success
      if (r.ok && j?.status === 'success') {
        chapaRefunded = true;
      } else {
        console.warn('[chapa refund] non-success:', j);
        // We still update our records — merchant may have refunded via other means
      }
    } catch (e) {
      console.warn('[chapa refund] error:', e.message);
      // Don't block — update order locally and let merchant handle Chapa separately
    }
  }

  // ── Mark order as refunded ─────────────────────────────────────────────────
  const { data: updated } = await sb.from('orders')
    .update({
      status: 'refunded',
      meta: {
        ...(order.meta || {}),
        refunded_at: new Date().toISOString(),
        refund_reason: reason,
        chapa_refunded: chapaRefunded,
        refunded_by: tg.id,
      },
    })
    .eq('id', order.id)
    .select()
    .single();

  // ── Notify customer via Telegram ───────────────────────────────────────────
  const customer = order.customers || {};
  if (customer.telegram_id) {
    let token;
    if (business.telegram_bot_token_enc) {
      try { token = decrypt(business.telegram_bot_token_enc); } catch {}
    }
    token = token || process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const cur = order.currency || 'ETB';
      const total = Number(order.total || 0).toLocaleString();
      const orderNum = order.id.slice(-6).toUpperCase();
      const text = `↩️ *Refund processed*\n\nOrder *#${orderNum}* — *${total} ${cur}*\n\nYour refund has been processed by *${business.name}*. Please allow a few business days for it to appear in your account.\n\n_Reason: ${reason}_`;
      sendTelegram(token, customer.telegram_id, text).catch(() => {});
    }
  }

  // Audit log
  await audit({
    business_id: business.id,
    actor_type: 'owner',
    actor_id: String(tg.id),
    action: 'refund.issued',
    resource_type: 'order',
    resource_id: params.id,
    metadata: {
      amount: order.total,
      currency: order.currency,
      reason,
      chapa_refunded: chapaRefunded,
      customer_name: order.customers?.name,
    },
    request,
  });

  return NextResponse.json({
    ok: true,
    order: updated,
    chapa_refunded: chapaRefunded,
    message: chapaRefunded
      ? 'Refund processed via Chapa and customer notified.'
      : 'Order marked as refunded. If a Chapa payment exists, please verify the refund in your Chapa dashboard.',
  });
}
