/**
 * What happens to a subscription once verify.et has (or hasn't) confirmed the
 * payment. Shared by the inline path (proof upload) and the async path
 * (verify.et webhook) so both can never drift into different rules — the whole
 * risk of having two entry points to the same money decision.
 *
 * Policy: verify first, then activate.
 *   accepted            → Pro active, payment_verified = TRUE
 *   rejected (settled)  → pending_review, admin told exactly why
 *   couldn't check      → pending_review, never silently granted, never lost
 *
 * The distinction that matters is `verdict.retryable`: "the bank says no" and
 * "we couldn't reach the verifier" both withhold access, but only the second
 * is the platform's fault, and the merchant is told a different thing.
 */
import { supabase } from './db';
import { decrypt } from './crypto';
import { tg } from './telegramApi';
import { logSubscriptionEvent } from './subscriptionEvents';
import { audit } from './audit';
import { REASON_TEXT } from './verifyEtDecision.mjs';
import { getPrimaryAdminId } from './admin';

const PLAN_MONTHS = { pro_monthly: 1, pro_annual: 12 };

/**
 * The `documents` storage bucket is private with no read policy, so the
 * getPublicUrl() string every upload route stores 404s ("Bucket not found")
 * for anyone who opens it — admin included. Re-sign it on read instead of
 * flipping the bucket's public/private posture, which other document types
 * stored there (logos, knowledge docs) also depend on.
 */
export async function signProofUrl(sb, url, expirySeconds = 3600) {
  if (!url) return null;
  const m = String(url).match(/\/object\/public\/documents\/([^?]+)/);
  if (!m) return url;
  try {
    const { data, error } = await sb.storage.from('documents').createSignedUrl(decodeURIComponent(m[1]), expirySeconds);
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch (e) {
    console.warn('[payment-verification] proof sign failed:', e.message);
  }
  return url;
}

/** Append-only record of the attempt. Never blocks the payment decision. */
export async function logVerification(row) {
  try {
    const sb = supabase();
    const { error } = await sb.from('payment_verifications').insert(row);
    if (error) console.warn('[payment-verification] log failed:', error.message);
  } catch (e) {
    // The table ships in supabase/migrations/verifyet_payment_verification.sql;
    // a missing table must not take payments down with it.
    console.warn('[payment-verification] log threw:', e.message);
  }
}

/**
 * Apply a verdict to a business.
 * Returns { activated, status, reason }.
 */
export async function applyVerificationOutcome({ business, result, verdict, plan = 'pro_monthly', method, bankReference, source = 'inline' }) {
  const sb = supabase();
  const now = new Date();
  const reasonText = REASON_TEXT[verdict.reason] || verdict.reason;
  const expected = business.verifyet_expected_etb != null ? Number(business.verifyet_expected_etb) : null;

  await logVerification({
    business_id: business.id,
    method: method || business.payment_method || null,
    bank_reference: bankReference || business.payment_bank_ref || null,
    our_reference: business.payment_ref || null,
    request_id: result?.requestId || business.verifyet_request_id || null,
    state: result?.state || 'error',
    accepted: !!verdict.accept,
    reason: verdict.reason,
    amount_etb: result?.amount ?? null,
    expected_etb: expected,
    sender: result?.sender || null,
    matched: result?.matched ?? null,
    match_confidence: result?.matchConfidence || null,
    source,
    raw: result?.raw || null,
  });

  let updates;
  let ownerText;

  if (verdict.accept) {
    const months = PLAN_MONTHS[plan] || 1;
    // Extend from an existing unexpired subscription rather than from today, so
    // paying early never costs the merchant the remainder of what they bought.
    const base = business.subscription_expires_at && new Date(business.subscription_expires_at) > now
      ? new Date(business.subscription_expires_at)
      : new Date(now);
    base.setMonth(base.getMonth() + months);

    updates = {
      subscription_status: 'active',
      plan_tier: 'pro',
      subscription_plan: 'pro',
      subscription_expires_at: base.toISOString(),
      payment_verified: true,
      payment_notes: `Verified by verify.et (${source}) — ${result?.amount ?? '?'} ETB from ${result?.sender || 'unknown'} — ${now.toISOString()}`,
      verifyet_request_id: null,   // released: the verification is settled
    };
    ownerText = `🎉 *Payment confirmed!*\n\nMiniMe Pro is active until *${base.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}*.\n\nVerified automatically against your bank — no waiting.`;

    logSubscriptionEvent({
      businessId: business.id,
      event: 'subscribed',
      plan,
      amountEtb: result?.amount ?? expected ?? null,
      meta: { source: 'verify.et', request_id: result?.requestId || null, match: result?.matchConfidence || null },
    });
  } else {
    updates = {
      subscription_status: 'pending_review',
      payment_verified: false,
      payment_notes: `verify.et could not confirm (${verdict.reason}) via ${source} — ${now.toISOString()}`,
    };
    ownerText = verdict.retryable
      ? `⏳ *We're still checking your payment*\n\nOur verification service couldn't confirm it yet (${reasonText}). We'll keep trying and a human will look within 24 hours — you don't need to pay again.`
      : `⚠️ *We couldn't confirm your payment*\n\nReason: ${reasonText}.\n\nIf you believe this is wrong, reply here with your transaction number and we'll check it by hand. Please don't pay twice.`;
  }

  await sb.from('businesses').update(updates).eq('id', business.id);

  await audit({
    business_id: business.id,
    actor_type: 'system',
    actor_id: 'verify.et',
    action: verdict.accept ? 'payment.verified' : 'payment.verification_failed',
    resource_type: 'business',
    resource_id: business.id,
    metadata: {
      reason: verdict.reason, source, plan,
      amount: result?.amount ?? null, expected,
      matched: result?.matched ?? null, confidence: result?.matchConfidence || null,
    },
  }).catch(() => {});

  await notifyOwner(business, ownerText);
  await notifyAdmin(business, result, verdict, reasonText, source);

  return { activated: !!verdict.accept, status: updates.subscription_status, reason: verdict.reason };
}

async function notifyOwner(business, text) {
  if (!business.telegram_bot_token_enc || !text) return;
  try {
    const token = decrypt(business.telegram_bot_token_enc);
    const chatId = business.owner_private_chat_id || business.owner_telegram_id;
    if (chatId) await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
  } catch (e) { console.warn('[payment-verification] owner notify:', e.message); }
}

async function notifyAdmin(business, result, verdict, reasonText, source) {
  const adminId = getPrimaryAdminId();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!adminId || !token) return;

  // A confirmed payment is an FYI; anything else needs a decision, so it gets
  // the buttons. A retryable failure is flagged as ours, not the merchant's.
  const text = verdict.accept
    ? `✅ *Payment verified* — ${business.name}\n${result?.amount ?? '?'} ETB from ${result?.sender || 'unknown'}\nMatch: ${result?.matchConfidence || 'n/a'} · via ${source}`
    : `${verdict.retryable ? '🟡' : '🔴'} *Payment NOT verified* — ${business.name}\nReason: ${reasonText}\n${result?.amount != null ? `Reported: ${result.amount} ETB\n` : ''}Ref: \`${business.payment_bank_ref || business.payment_ref || '—'}\`\n_${verdict.retryable ? 'Could not check — worth retrying.' : 'Checked and rejected.'}_`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminId,
        text,
        parse_mode: 'Markdown',
        reply_markup: verdict.accept ? undefined : {
          inline_keyboard: [[
            { text: '✅ Approve anyway', callback_data: `sub_approve_${business.id}` },
            { text: '❌ Reject', callback_data: `sub_reject_${business.id}` },
          ]],
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) { console.warn('[payment-verification] admin notify:', e.message); }
}
