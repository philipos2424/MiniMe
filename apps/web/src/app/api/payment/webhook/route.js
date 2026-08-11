/**
 * POST /api/payment/webhook
 * Webhook handler for Stripe, Chapa, PayPal, and payment callbacks.
 * Automatically updates plan, remaining credits, and expiry date upon successful payment.
 */
import { NextResponse } from 'next/server';
import { upgradeSubscription } from '../../../../lib/server/billing';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const text = await request.text();
    let body = {};
    try { body = JSON.parse(text); } catch {}

    const searchParams = new URL(request.url).searchParams;
    const provider = searchParams.get('provider') || body.provider || 'unknown';

    let businessId = body.metadata?.businessId || body.businessId || body.custom_fields?.business_id;
    let plan = body.metadata?.plan || body.plan || 'starter';
    let txRef = body.tx_ref || body.reference || body.id || `tx-${Date.now()}`;
    let isSuccess = false;

    // 1. Stripe Webhook parsing
    if (body.type === 'checkout.session.completed' || body.object === 'event') {
      const session = body.data?.object || {};
      businessId = session.metadata?.businessId || session.client_reference_id;
      plan = session.metadata?.plan || 'starter';
      txRef = session.payment_intent || session.id;
      isSuccess = session.payment_status === 'paid';
    }
    // 2. Chapa Webhook parsing
    else if (body.status === 'success' || body.event === 'charge.success') {
      txRef = body.tx_ref;
      isSuccess = true;
    }
    // 3. PayPal Webhook parsing
    else if (body.event_type === 'PAYMENT.CAPTURE.COMPLETED' || body.resource_state === 'completed') {
      txRef = body.resource?.id || body.id;
      isSuccess = true;
    }
    // 4. Default JSON payload check
    else if (body.status === 'completed' || body.status === 'success' || body.paid === true) {
      isSuccess = true;
    }

    if (isSuccess && (businessId || txRef)) {
      const sb = supabase();
      if (!businessId && txRef) {
        const { data: biz } = await sb.from('businesses').select('id').eq('payment_ref', txRef).single();
        businessId = biz?.id;
      }

      if (businessId) {
        const updatedSub = await upgradeSubscription(businessId, {
          planName: plan,
          paymentReference: txRef,
          paymentMethod: provider,
        });

        return NextResponse.json({ ok: true, message: 'Subscription upgraded', subscription: updatedSub });
      }
    }

    return NextResponse.json({ ok: true, status: 'ignored' });
  } catch (e) {
    console.error('[payment/webhook] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
