/**
 * Completing a Pro subscription payment — the one place a gateway payment
 * turns into Pro time.
 *
 * Rule: nothing from an incoming request is trusted. Every entry point passes
 * only an identifier (Chapa tx_ref, Stripe Checkout Session id, PayPal order
 * id); the payment is re-read from the gateway's own API with our secret key,
 * and only a payment the gateway reports as paid is credited. Each payment is
 * credited once, and the period granted is the one the verified amount covers.
 *
 * Callers: /api/payment/callback (Chapa), /api/payment/webhook (Stripe,
 * PayPal, legacy Chapa callbacks) and the billing page on return from checkout.
 */
import { supabase } from './db';
import { getSetting } from './platformSettings';
import { PRO_PERIODS, periodForAmount } from '../plan';
import { extendSubscription } from '../paymentReview.mjs';

const PAID_PREFIX = 'paid:';

/** Has this gateway reference already been credited? */
async function alreadyCredited(sb, businessId, ref) {
  const { data } = await sb.from('subscription_events')
    .select('id').eq('business_id', businessId).contains('meta', { tx_ref: ref }).limit(1);
  return !!(data && data.length);
}

/**
 * Claim a reference so two deliveries of the same payment (Chapa's GET return
 * and its POST webhook, a webhook retry, the billing page confirming) credit it
 * once. The guarded update only succeeds for the first caller.
 */
async function claim(sb, businessId, ref) {
  const { data } = await sb.from('businesses')
    .update({ payment_ref: PAID_PREFIX + ref })
    .eq('id', businessId).eq('payment_ref', ref)
    .select('id');
  if (data && data.length) return true;
  // The owner may have started another checkout since, which replaced
  // payment_ref. The payment is still real; fall back to the event log.
  return !(await alreadyCredited(sb, businessId, ref));
}

async function notifyOwner(biz, text) {
  const chatId = biz.owner_private_chat_id || biz.owner_telegram_id;
  if (!chatId) return;
  let token = process.env.TELEGRAM_BOT_TOKEN;
  if (biz.telegram_bot_token_enc) {
    try { const { decrypt } = await import('./crypto'); token = decrypt(biz.telegram_bot_token_enc); } catch {}
  }
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

/** Extend Pro by `period` from today, or from the current expiry if later. */
async function grant(sb, businessId, { period, ref, source, amount, currency }) {
  const { data: biz } = await sb.from('businesses')
    .select('id, subscription_status, subscription_expires_at, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc')
    .eq('id', businessId).maybeSingle();
  if (!biz) return { ok: false, reason: 'no_business' };

  const now = new Date();
  const base = new Date(extendSubscription(biz.subscription_expires_at, period.months, now.getTime()));

  const { error } = await sb.from('businesses').update({
    subscription_status: 'active',
    plan_tier: 'pro',
    subscription_plan: 'pro',
    subscription_expires_at: base.toISOString(),
    payment_verified: true,
    payment_notes: `Paid via ${source} (${period.label}) — ${ref} — ${now.toISOString()}`,
  }).eq('id', businessId);
  if (error) return { ok: false, reason: 'update_failed' };

  // Awaited, not fire-and-forget: this row is also the duplicate check in claim().
  await sb.from('subscription_events').insert({
    business_id: businessId,
    event: biz.subscription_status === 'active' ? 'renewed' : 'subscribed',
    plan: period.key,
    amount_etb: currency === 'ETB' ? amount : null,
    meta: { tx_ref: ref, source, amount, currency },
  }).then(() => {}, e => console.warn('[subscription-payments] event insert failed:', e.message));

  const until = base.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  await notifyOwner(biz, `🎉 *MiniMe Pro activated!*\n\nThank you. Your subscription is active until *${until}*.`);
  return { ok: true, expires_at: base.toISOString(), period: period.key };
}

// ── Chapa ───────────────────────────────────────────────────────────────────
export async function completeChapaSubscription(txRef) {
  if (!txRef || !String(txRef).startsWith('sub-')) return { ok: false, reason: 'not_subscription' };
  const key = await getSetting('gateway.chapa.secret');
  if (!key) return { ok: false, reason: 'chapa_not_configured' };

  let payment;
  try {
    const r = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(txRef)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: 'verify_failed', retryable: true };
    payment = j?.data || {};
  } catch {
    return { ok: false, reason: 'verify_unreachable', retryable: true };
  }
  if (String(payment.status || '').toLowerCase() !== 'success') return { ok: false, reason: 'not_paid' };
  if (String(payment.currency || 'ETB').toUpperCase() !== 'ETB') return { ok: false, reason: 'wrong_currency' };

  const amount = Number(payment.amount || 0);
  if (amount + 5 < PRO_PERIODS.pro_monthly.amount) return { ok: false, reason: 'amount_short' };

  const sb = supabase();
  const { data: biz } = await sb.from('businesses').select('id')
    .in('payment_ref', [txRef, PAID_PREFIX + txRef]).maybeSingle();
  if (!biz) return { ok: false, reason: 'no_business' };
  if (!(await claim(sb, biz.id, txRef))) return { ok: true, duplicate: true };
  return grant(sb, biz.id, { period: periodForAmount(amount), ref: txRef, source: 'Chapa', amount, currency: 'ETB' });
}

// ── Stripe (card, monthly) ──────────────────────────────────────────────────
export async function completeStripeSession(sessionId) {
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(String(sessionId))) return { ok: false, reason: 'bad_session' };
  const key = await getSetting('gateway.stripe.secret');
  if (!key) return { ok: false, reason: 'stripe_not_configured' };

  let session;
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    session = await r.json();
    if (!r.ok) return { ok: false, reason: 'verify_failed', retryable: r.status >= 500 };
  } catch {
    return { ok: false, reason: 'verify_unreachable', retryable: true };
  }
  if (session.payment_status !== 'paid') return { ok: false, reason: 'not_paid' };
  const businessId = session.metadata?.businessId || session.client_reference_id;
  const ref = session.metadata?.txRef || session.id;
  if (!businessId) return { ok: false, reason: 'no_business' };

  const sb = supabase();
  if (!(await claim(sb, businessId, ref))) return { ok: true, duplicate: true };
  return grant(sb, businessId, {
    period: PRO_PERIODS.pro_monthly, ref, source: 'Stripe',
    amount: (session.amount_total || 0) / 100, currency: String(session.currency || 'usd').toUpperCase(),
  });
}

// ── PayPal (card, monthly) ──────────────────────────────────────────────────
async function paypalToken() {
  const id = await getSetting('gateway.paypal.id');
  const secret = await getSetting('gateway.paypal.secret');
  if (!id || !secret) return null;
  const r = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({}));
  return j.access_token || null;
}

/**
 * The buyer approving a PayPal order moves no money — it has to be captured.
 * Nothing used to capture, so PayPal payments never completed. This captures
 * an approved order, then credits it once PayPal reports it COMPLETED.
 */
export async function completePaypalOrder(orderId) {
  if (!orderId || !/^[A-Z0-9]{8,32}$/.test(String(orderId))) return { ok: false, reason: 'bad_order' };
  let token;
  try { token = await paypalToken(); } catch { return { ok: false, reason: 'verify_unreachable', retryable: true }; }
  if (!token) return { ok: false, reason: 'paypal_not_configured' };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const url = `https://api-m.paypal.com/v2/checkout/orders/${encodeURIComponent(orderId)}`;

  let order;
  try {
    let r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    order = await r.json();
    if (!r.ok) return { ok: false, reason: 'verify_failed' };
    if (order.status === 'APPROVED') {
      r = await fetch(`${url}/capture`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(15000) });
      const captured = await r.json();
      // A concurrent capture reports ORDER_ALREADY_CAPTURED; re-read the order.
      order = r.ok ? captured : await (await fetch(url, { headers, signal: AbortSignal.timeout(10000) })).json();
    }
  } catch {
    return { ok: false, reason: 'verify_unreachable', retryable: true };
  }
  if (order.status !== 'COMPLETED') return { ok: false, reason: 'not_paid' };

  const unit = order.purchase_units?.[0] || {};
  const capture = unit.payments?.captures?.[0];
  if (capture && capture.status !== 'COMPLETED') return { ok: false, reason: 'not_paid' };
  const businessId = unit.custom_id;
  const ref = unit.reference_id || order.id;
  if (!businessId) return { ok: false, reason: 'no_business' };

  const sb = supabase();
  if (!(await claim(sb, businessId, ref))) return { ok: true, duplicate: true };
  return grant(sb, businessId, {
    period: PRO_PERIODS.pro_monthly, ref, source: 'PayPal',
    amount: Number(capture?.amount?.value || unit.amount?.value || 0), currency: capture?.amount?.currency_code || 'USD',
  });
}
