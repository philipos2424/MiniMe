/**
 * POST /api/payment/polar/webhook
 *
 * Polar's signed `order.paid` event is the sole way a Polar checkout can
 * grant MiniMe Pro. A browser return or an unsigned JSON body never changes
 * entitlements.
 */
import { NextResponse } from 'next/server';
import { webhooks } from '@polar-sh/sdk/2026-10';
import { upgradeSubscription } from '../../../../../lib/server/billing';
import { supabase } from '../../../../../lib/server/db';
import { audit } from '../../../../../lib/server/audit';
import { sendTrialActivatedMessage } from '../../../../../lib/server/trialActivation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function polarHeaders(request) {
  return {
    'webhook-id': request.headers.get('webhook-id') || '',
    'webhook-timestamp': request.headers.get('webhook-timestamp') || '',
    'webhook-signature': request.headers.get('webhook-signature') || '',
  };
}

export async function POST(request) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'unverified' }, { status: 401 });

  const raw = await request.text();
  let event;
  try {
    // Validate the untouched bytes before examining any event field.
    event = await webhooks.validateEvent(raw, polarHeaders(request), secret);
  } catch (error) {
    console.error('[polar/webhook] rejected:', error.message);
    return NextResponse.json({ error: 'unverified' }, { status: 401 });
  }

  if (event?.name !== 'order.paid') return NextResponse.json({ ok: true, status: 'ignored' });

  const productId = process.env.POLAR_PRO_PRODUCT_ID;
  const order = event.metadata || {};
  const businessId = event.external_customer_id;
  const orderId = order.order_id;
  if (!productId || order.product_id !== productId || !businessId || !orderId) {
    return NextResponse.json({ ok: true, status: 'ignored' });
  }

  const sb = supabase();
  // Polar retries deliveries. payment_ref is the durable order key, so a
  // retry must not extend the subscription twice.
  const { data: existing } = await sb.from('businesses').select('payment_ref').eq('id', businessId).maybeSingle();
  if (!existing || existing.payment_ref === orderId) {
    return NextResponse.json({ ok: true, status: existing ? 'duplicate' : 'ignored' });
  }

  const subscription = await upgradeSubscription(businessId, {
    planName: 'pro',
    paymentReference: orderId,
    paymentMethod: 'polar',
    durationMonths: 1,
  });
  await sb.from('businesses').update({ payment_verified: true, payment_method: 'polar' }).eq('id', businessId);

  const { data: business } = await sb
    .from('businesses')
    .select('id, name, plan_tier, subscription_expires_at, owner_telegram_id, owner_private_chat_id')
    .eq('id', businessId).maybeSingle();
  if (business) {
    sendTrialActivatedMessage(business, { planTier: business.plan_tier, expiresAt: business.subscription_expires_at, paid: true })
      .catch(e => console.warn('[polar/welcome]', e.message));
  }
  await audit({
    business_id: businessId,
    actor_type: 'system',
    actor_id: 'polar',
    action: 'payment.webhook_upgrade',
    resource_type: 'subscription',
    resource_id: businessId,
    metadata: { provider: 'polar', order_id: orderId, event_id: event.id },
    request,
  });

  return NextResponse.json({ ok: true, subscription });
}
