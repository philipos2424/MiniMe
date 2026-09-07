/**
 * POST /api/payment/webhook — gateway callbacks (Chapa, Stripe).
 *
 * SECURITY: this endpoint grants Pro. It previously did so on ANY unsigned
 * POST — `{"status":"completed","businessId":"<uuid>"}` from anywhere on the
 * internet was enough, and it resolved businessId from payment_ref too, so
 * even the UUID wasn't needed. It notified nobody and wrote no audit row, so a
 * forged grant was indistinguishable from a real one after the fact.
 *
 * Every request must now carry a signature we can verify against the shared
 * secret for its provider. Anything unsigned, wrongly signed, or from a
 * provider we hold no secret for is rejected BEFORE any lookup — an attacker
 * must not even be able to probe which payment_refs exist.
 *
 * The invariant to preserve when editing this file: no code path may reach
 * upgradeSubscription() without having passed verifySignature() first.
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { upgradeSubscription } from '../../../../lib/server/billing';
import { supabase } from '../../../../lib/server/db';
import { getSetting } from '../../../../lib/server/platformSettings';
import { audit } from '../../../../lib/server/audit';
import { sendTrialActivatedMessage, notifyAdminActivation } from '../../../../lib/server/trialActivation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Constant-time compare that can't throw on length mismatch. */
function safeEqual(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  if (A.length !== B.length || !A.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Stripe signs `${timestamp}.${rawBody}` and sends `t=…,v1=…`. The timestamp is
 * part of the signed material specifically so a captured-and-replayed webhook
 * stops being accepted; checking the signature without checking the age throws
 * that away, so we enforce a 5-minute window.
 */
function verifyStripe(raw, header, secret) {
  const parts = Object.fromEntries(String(header || '').split(',').map(p => p.split('=')));
  const t = Number(parts.t);
  if (!t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > 300) return false;
  return safeEqual(parts.v1, hmacHex(secret, `${t}.${raw}`));
}

/** Chapa sends the HMAC of the raw body, keyed on the secret key. */
function verifyChapa(raw, header, secret) {
  return safeEqual(header, hmacHex(secret, raw));
}

export async function POST(request) {
  try {
    const raw = await request.text();

    const stripeSig = request.headers.get('stripe-signature');
    const chapaSig = request.headers.get('chapa-signature')
      || request.headers.get('x-chapa-signature');

    let provider = null;

    if (stripeSig) {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        console.error('[payment/webhook] REJECTED stripe: STRIPE_WEBHOOK_SECRET unset');
        return NextResponse.json({ error: 'unverified' }, { status: 401 });
      }
      if (!verifyStripe(raw, stripeSig, secret)) {
        console.error('[payment/webhook] REJECTED stripe: bad signature');
        return NextResponse.json({ error: 'unverified' }, { status: 401 });
      }
      provider = 'stripe';
    } else if (chapaSig) {
      // Chapa signs with the "Secret Hash" set in its own dashboard, which is
      // NOT necessarily the API secret key. CHAPA_WEBHOOK_SECRET is the value
      // to set once that's confirmed; the API key is only a fallback so this
      // isn't dead on arrival if the two happen to match.
      const secret = process.env.CHAPA_WEBHOOK_SECRET
        || await getSetting('gateway.chapa.secret');
      if (!secret || secret === 'sk-placeholder') {
        console.error('[payment/webhook] REJECTED chapa: no secret configured');
        return NextResponse.json({ error: 'unverified' }, { status: 401 });
      }
      if (!verifyChapa(raw, chapaSig, secret)) {
        console.error('[payment/webhook] REJECTED chapa: bad signature');
        return NextResponse.json({ error: 'unverified' }, { status: 401 });
      }
      provider = 'chapa';
    } else {
      // The old free-Pro hole. Unsigned means unauthenticated, full stop.
      console.error('[payment/webhook] REJECTED: unsigned request');
      return NextResponse.json({ error: 'unsigned' }, { status: 401 });
    }

    let body = {};
    try { body = JSON.parse(raw); } catch {}

    // ── Success detection, per provider ──────────────────────────────────────
    // Only shapes the verified provider actually sends. The old catch-all
    // (`body.paid === true || body.status === 'success'`) accepted any JSON
    // with the right word in it.
    let businessId = null;
    let txRef = null;
    let isSuccess = false;
    let plan = 'pro';

    if (provider === 'stripe') {
      const session = body.data?.object || {};
      isSuccess = body.type === 'checkout.session.completed' && session.payment_status === 'paid';
      businessId = session.metadata?.businessId || session.client_reference_id || null;
      plan = session.metadata?.plan || 'pro';
      txRef = session.payment_intent || session.id || null;
    } else {
      isSuccess = body.status === 'success' || body.event === 'charge.success';
      txRef = body.tx_ref || body.reference || null;
      businessId = body.metadata?.businessId || null;
    }

    if (!isSuccess || (!businessId && !txRef)) {
      return NextResponse.json({ ok: true, status: 'ignored' });
    }

    const sb = supabase();
    if (!businessId && txRef) {
      const { data: biz } = await sb.from('businesses').select('id').eq('payment_ref', txRef).maybeSingle();
      businessId = biz?.id || null;
    }
    if (!businessId) return NextResponse.json({ ok: true, status: 'ignored' });

    const updatedSub = await upgradeSubscription(businessId, {
      planName: plan,
      paymentReference: txRef,
      paymentMethod: provider,
    });

    // A real payment, so the row is marked verified — this is the one grant
    // path where money is known to have moved.
    await sb.from('businesses')
      .update({ payment_verified: true, payment_method: provider })
      .eq('id', businessId);

    const { data: business } = await sb.from('businesses')
      .select('id, name, plan_tier, subscription_expires_at, owner_telegram_id, owner_private_chat_id')
      .eq('id', businessId).maybeSingle();

    if (business) {
      sendTrialActivatedMessage(business, {
        planTier: business.plan_tier,
        expiresAt: business.subscription_expires_at,
        paid: true,
      }).catch(e => console.warn('[webhook-welcome]', e.message));

      notifyAdminActivation({
        business,
        source: `webhook:${provider}`,
        planTier: business.plan_tier,
        expiresAt: business.subscription_expires_at,
        paid: true,
        detail: `ref ${txRef || '—'}`,
      }).catch(e => console.warn('[webhook-admin-alert]', e.message));
    }

    await audit({
      business_id: businessId,
      actor_type: 'system',
      actor_id: provider,
      action: 'payment.webhook_upgrade',
      resource_type: 'subscription',
      resource_id: businessId,
      metadata: { provider, tx_ref: txRef, plan },
      request,
    });

    return NextResponse.json({ ok: true, message: 'Subscription upgraded', subscription: updatedSub });
  } catch (e) {
    console.error('[payment/webhook] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
