/**
 * POST /api/payment/webhook
 *
 * Payment notifications for Stripe, PayPal and (older checkouts) Chapa, plus
 * the billing page confirming a checkout the owner just returned from.
 *
 * Nothing in the request body is trusted. This route used to grant Pro to any
 * request saying `{ businessId, paid: true }` — no signature, no check with the
 * gateway — so anyone with a business id could unlock Pro for free. Now the
 * body may only name a payment (a Stripe Checkout Session id, a PayPal order
 * id, a Chapa tx_ref); lib/server/subscriptionPayments re-reads that payment
 * from the gateway's own API with our secret key and credits it only if the
 * gateway says it is paid, once.
 */
import { NextResponse } from 'next/server';
import { completeChapaSubscription, completePaypalOrder, completeStripeSession } from '../../../../lib/server/subscriptionPayments';
import { rateLimit, getIP } from '../../../../lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Which payment this request names, if any. Only identifiers are read. */
function paymentFrom(body, params) {
  // Billing page return / explicit confirmation.
  if (body.provider === 'stripe' && body.session_id) return { provider: 'stripe', id: body.session_id };
  if (body.provider === 'paypal' && body.order_id) return { provider: 'paypal', id: body.order_id };
  // Stripe event (dashboard webhook).
  if (body.type === 'checkout.session.completed' || body.type === 'checkout.session.async_payment_succeeded') {
    return { provider: 'stripe', id: body.data?.object?.id };
  }
  // PayPal events (dashboard webhook): the order id lives in different places.
  if (body.event_type === 'CHECKOUT.ORDER.APPROVED' || body.event_type === 'CHECKOUT.ORDER.COMPLETED') {
    return { provider: 'paypal', id: body.resource?.id };
  }
  if (body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    return { provider: 'paypal', id: body.resource?.supplementary_data?.related_ids?.order_id };
  }
  // Chapa (checkouts created before callback_url moved to /api/payment/callback).
  const chapaRef = body.tx_ref || body.trx_ref || params.get('tx_ref') || params.get('trx_ref');
  if (chapaRef) return { provider: 'chapa', id: chapaRef };
  return null;
}

async function complete(payment) {
  if (payment.provider === 'stripe') return completeStripeSession(payment.id);
  if (payment.provider === 'paypal') return completePaypalOrder(payment.id);
  return completeChapaSubscription(payment.id);
}

export async function POST(request) {
  // Each call costs a gateway API request; keep anonymous callers in check.
  const { ok: allowed } = rateLimit(getIP(request), 'payment_webhook', 30, 60);
  if (!allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });

  let body = {};
  try { body = JSON.parse(await request.text()) || {}; } catch {}
  const payment = paymentFrom(body, new URL(request.url).searchParams);
  if (!payment?.id) return NextResponse.json({ ok: true, status: 'ignored' });

  try {
    const result = await complete(payment);
    // 5xx on a gateway outage so the gateway retries; 200 otherwise so a
    // rejected or duplicate notification isn't retried forever.
    if (result.retryable) return NextResponse.json({ ok: false, reason: result.reason }, { status: 503 });
    return NextResponse.json({
      ok: !!result.ok,
      status: result.ok ? (result.duplicate ? 'already_credited' : 'credited') : 'not_credited',
      reason: result.reason,
    });
  } catch (e) {
    console.error('[payment/webhook] error:', e.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

/** Chapa may call the callback URL with GET (?trx_ref=…). */
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const ref = params.get('trx_ref') || params.get('tx_ref');
  if (!ref) return NextResponse.json({ ok: true, status: 'ignored' });
  const result = await completeChapaSubscription(ref).catch(() => ({ ok: false, retryable: true }));
  return NextResponse.json({ ok: !!result.ok }, { status: result.retryable ? 503 : 200 });
}
