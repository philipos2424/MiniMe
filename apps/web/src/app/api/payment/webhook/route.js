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
import { verifiedPurchasePayment, matchesPurchase, confirmChapaPayment } from '../../../../lib/server/subscriptionPurchase.mjs';

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
    // Standard Chapa delivers both headers: x-chapa-signature binds the body,
    // while chapa-signature may be a static secret hash. Prefer body binding.
    const chapaSig = request.headers.get('x-chapa-signature')
      || request.headers.get('chapa-signature');

    let provider = null;

    if (stripeSig) {
      const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
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
      const secret = process.env.CHAPA_WEBHOOK_SECRET?.trim()
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

    let payment = verifiedPurchasePayment(provider, body);
    if (!payment?.reference) {
      return NextResponse.json({ ok: true, status: 'ignored' });
    }
    if (provider === 'chapa') {
      payment = await confirmChapaPayment(payment, await getSetting('gateway.chapa.secret'));
      if (!payment) return NextResponse.json({ error: 'payment_unverified' }, { status: 409 });
    }
    const sb = supabase();
    const { data: purchase, error } = await sb.from('subscription_purchases')
      .select('*').eq('reference', payment.reference).maybeSingle();
    if (error) throw error;
    if (!matchesPurchase(purchase, provider, payment)) {
      // Old sessions without a recorded price/term require reconciliation;
      // signed metadata alone must not choose an arbitrary entitlement.
      await audit({ actor_type: 'system', actor_id: provider,
        action: 'payment.reconciliation_required', resource_type: 'subscription',
        metadata: { provider, reference: payment.reference }, request });
      return NextResponse.json({ error: 'payment_mismatch' }, { status: 409 });
    }
    const businessId = purchase.business_id;
    const txRef = purchase.reference;
    const plan = purchase.plan;
    const updatedSub = await upgradeSubscription(businessId, {
      planName: plan,
      paymentReference: txRef,
      paymentMethod: provider,
      verifiedPayment: payment,
    });
    if (updatedSub.duplicate) return NextResponse.json({ ok: true, status: 'duplicate' });

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
    return NextResponse.json({ error: 'payment_processing_failed' }, { status: 500 });
  }
}
