/**
 * POST /api/payment/verify-et/webhook — verify.et verification.completed.
 *
 * Most verifications answer inline within waitMs, but a slow bank pushes the
 * result here instead. Without this endpoint every slow verification would sit
 * in pending_review until a human looked at it, which defeats the point of
 * automating the check.
 *
 * Security: verify.et signs deliveries with X-Webhook-Signature when a secret
 * is configured. If we hold a secret we REQUIRE a valid signature — an
 * unauthenticated endpoint that activates paid subscriptions is a way to grant
 * yourself Pro by POSTing JSON. If no secret is configured the endpoint refuses
 * outright rather than trusting the internet.
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabase } from '../../../../../lib/server/db';
import { verifyEtConfig } from '../../../../../lib/server/verifyEt';
import { normalise, decide, REASON_TEXT } from '../../../../../lib/server/verifyEtDecision.mjs';
import { applyVerificationOutcome } from '../../../../../lib/server/paymentVerification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function signatureMatches(secret, rawBody, provided) {
  if (!provided) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // Accept a bare hex digest or a "sha256=<hex>" style header.
  const got = String(provided).replace(/^sha256=/i, '').trim();
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(got, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  const cfg = await verifyEtConfig();
  if (!cfg.webhookSecret) {
    // Fail closed. Polling still covers the slow path.
    console.warn('[verify-et webhook] rejected — no webhook secret configured');
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const raw = await request.text();
  if (!signatureMatches(cfg.webhookSecret, raw, request.headers.get('x-webhook-signature'))) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  const requestId = body?.requestId || body?.data?.requestId;
  if (!requestId) return NextResponse.json({ error: 'no_request_id' }, { status: 400 });

  const sb = supabase();
  // Find the payment this verification belongs to. The request id was stored
  // when we submitted it; an unknown id is not ours to act on.
  const { data: biz } = await sb.from('businesses')
    .select('id, name, payment_ref, payment_method, payment_notes, subscription_status, subscription_expires_at, plan_tier, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, verifyet_request_id, verifyet_expected_etb, verifyet_plan')
    .eq('verifyet_request_id', requestId)
    .maybeSingle();

  if (!biz) {
    // 200 so verify.et stops retrying something we will never match.
    return NextResponse.json({ ok: true, ignored: 'unknown_request_id' });
  }

  const result = normalise(body);
  const verdict = decide(result, { expectedEtb: biz.verifyet_expected_etb || null });

  await applyVerificationOutcome({
    business: biz,
    result,
    verdict,
    plan: biz.verifyet_plan || 'pro_monthly',
    source: 'webhook',
  });

  return NextResponse.json({
    ok: true,
    business_id: biz.id,
    accepted: verdict.accept,
    reason: REASON_TEXT[verdict.reason] || verdict.reason,
  });
}
