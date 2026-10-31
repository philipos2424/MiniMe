/**
 * Check a Pro subscription payment proof (screenshot + bank transaction
 * number) and act on it: verify.et when configured, otherwise admin review.
 * Shared by the Mini App upload (/api/payment/subscribe/proof) and the
 * in-chat upgrade in the bot, so both run the same checks.
 *
 * Returns { status, body } — the HTTP status and JSON the route would send.
 */
import { supabase } from './db';
import { decrypt } from './crypto';
import { tg } from './telegramApi';
import { getSettings } from './platformSettings';
import { PRO_PERIODS } from '../plan';
import { verifyTransaction, isConfigured as verifyEtConfigured } from './verifyEt';
import { decide, REASON_TEXT } from './verifyEtDecision.mjs';
import { applyVerificationOutcome, logVerification, signProofUrl } from './paymentVerification';
import { getPrimaryAdminId } from './admin';

/**
 * A receipt the owner can actually keep.
 *
 * The confirmation used to be one line ("Pro is now active") with no amount,
 * reference, method or issuer — nothing a shop could file or use to prove they
 * paid 1,999 ETB.
 *
 * Issuer details come from env with NO fallbacks, same rule as the payment
 * accounts: a line we can't fill is a line we omit, never a placeholder. Set
 * RECEIPT_ISSUER_NAME / RECEIPT_ISSUER_TIN / RECEIPT_ISSUER_CONTACT to have
 * them appear.
 */
async function receiptBlock({ planDef, method, txRef, until }) {
  const paidAt = new Date();
  const lines = [
    '— — — — — — — — — —',
    '*RECEIPT*',
    `Item: MiniMe Pro — ${planDef.months} month${planDef.months === 1 ? '' : 's'}`,
    `Amount: *${Number(planDef.amount).toLocaleString('en-US')} ETB*`,
    `Method: ${String(method).replace('_manual', '')}`,
    `Reference: \`${txRef}\``,
    `Date: ${paidAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
  ];
  if (until) {
    lines.push(`Covers until: ${new Date(until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
  }

  // Editable at /admin/settings; falls back to env. Unset lines are omitted.
  const s = await getSettings(['receipt.issuer.name', 'receipt.issuer.tin', 'receipt.issuer.contact']);
  const issuer = s['receipt.issuer.name'];
  const tin = s['receipt.issuer.tin'];
  const contact = s['receipt.issuer.contact'];
  if (issuer || tin || contact) {
    lines.push('');
    if (issuer) lines.push(`Issued by: ${issuer}`);
    if (tin) lines.push(`TIN: ${tin}`);
    if (contact) lines.push(`Contact: ${contact}`);
  }

  return lines.join('\n');
}

export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = /^image\/(jpeg|png|webp|heic)$/i;

// Amounts and durations come from lib/plan.js — one source for every rail.
const PLANS = PRO_PERIODS;


export async function submitSubscriptionProof({ business, buf, mime, txRef, method, plan = 'pro_monthly', bankRef = '' }) {
  const planKey = PLANS[plan] ? plan : 'pro_monthly';
  const planDef = PLANS[planKey];
  const ext = mime.split('/')[1] || 'jpg';
  const storagePath = `payment-proofs/${business.id}/${txRef}.${ext}`;
  const sb = supabase();

  const { error: upErr } = await sb.storage.from('documents').upload(storagePath, buf, {
    contentType: mime,
    upsert: true,
  });
  if (upErr) {
    console.error('payment proof upload failed:', upErr.message);
    return { status: 500, body: { error: `Upload failed: ${upErr.message}` } };
  }
  const { data: pub } = sb.storage.from('documents').getPublicUrl(storagePath);
  const proofUrl = pub?.publicUrl;

  // ── Automated verification (verify.et) ─────────────────────────────────────
  // Policy: verify first, then activate. The screenshot is kept as evidence but
  // is no longer what grants access — it never proved anything. When verify.et
  // is configured this decides the outcome for BOTH plans; the old hybrid
  // (monthly on trust, annual by eyeball) only applies when it isn't.
  if (await verifyEtConfigured()) {
    const expectedEtb = planDef.amount;

    if (!bankRef) {
      return { status: 400, body: {
        error: 'bank_reference_required',
        message: 'Enter the transaction number from your Telebirr receipt or CBE SMS so we can confirm the payment automatically.',
      } };
    }

    // Refuse a reference already used by a DIFFERENT business before spending a
    // verification credit — one real receipt must not unlock two subscriptions.
    const { data: reused } = await sb.from('payment_verifications')
      .select('business_id').eq('bank_reference', bankRef).eq('accepted', true)
      .neq('business_id', business.id).limit(1);
    if (reused?.length) {
      await logVerification({
        business_id: business.id, method, bank_reference: bankRef, our_reference: txRef,
        state: 'failed', accepted: false, reason: 'reference_already_used',
        expected_etb: expectedEtb, source: 'inline',
      });
      return { status: 409, body: {
        error: 'reference_already_used',
        message: 'That transaction number has already been used for another subscription.',
      } };
    }

    // Persist what the async path will need before the call — a webhook can
    // arrive before this request finishes.
    await sb.from('businesses').update({
      payment_bank_ref: bankRef,
      payment_method: method,
      payment_proof_url: proofUrl,
      verifyet_expected_etb: expectedEtb,
      verifyet_plan: planKey,
    }).eq('id', business.id);

    const webUrl = process.env.WEB_URL || '';
    const result = await verifyTransaction({
      method,
      reference: bankRef,
      // Same merchant + same bank reference is the same verification, however
      // many times a flaky connection makes them hit Submit.
      idempotencyKey: `${business.id}:${bankRef}`,
      webhookUrl: webUrl ? `${webUrl}/api/payment/verify-et/webhook` : null,
    });

    if (result.ok && result.state === 'queued') {
      // Still running. Park it — the webhook (or a later poll) finishes the job.
      await sb.from('businesses').update({
        subscription_status: 'pending_review',
        payment_verified: false,
        verifyet_request_id: result.requestId || null,
        payment_notes: `Awaiting verify.et — ${method} — bank ref ${bankRef} — ${new Date().toISOString()}`,
      }).eq('id', business.id);
      await logVerification({
        business_id: business.id, method, bank_reference: bankRef, our_reference: txRef,
        request_id: result.requestId || null, state: 'queued', accepted: false, reason: 'queued',
        expected_etb: expectedEtb, source: 'inline', raw: result.raw || null,
      });
      return { status: 200, body: {
        ok: true, status: 'verifying',
        message: 'Checking your payment with the bank — this usually takes a few seconds. We\'ll message you the moment it clears.',
      } };
    }

    const verdict = decide(result, { expectedEtb });
    const outcome = await applyVerificationOutcome({
      business: { ...business, verifyet_expected_etb: expectedEtb, payment_bank_ref: bankRef },
      result, verdict, plan: planKey, method, bankReference: bankRef, source: 'inline',
    });

    return { status: 200, body: {
      ok: true,
      status: outcome.activated ? 'active' : 'pending_review',
      verified: outcome.activated,
      reason: outcome.activated ? null : (REASON_TEXT[verdict.reason] || verdict.reason),
      retryable: outcome.activated ? false : !!verdict.retryable,
      proof_url: proofUrl,
    } };
  }

  // ── Fallback: no verify.et configured ──────────────────────────────────────
  // Every period waits for admin review. Monthly used to auto-activate on the
  // screenshot alone, and Pro was granted on bank refs like "Ffhh" and a photo
  // of a ring light. pending_review keeps any trial or unexpired subscription
  // the owner already has (planStatus), so nobody loses access while waiting.
  // verifyet_plan records the period so the approval grants what was paid for.
  const now = new Date();
  const updates = {
    subscription_status: 'pending_review',
    payment_proof_url: proofUrl,
    payment_verified: false,
    payment_method: method,
    verifyet_plan: planKey,
    ...(bankRef ? { payment_bank_ref: bankRef } : {}),
    payment_notes: `${planDef.label} pending review — ${method} — ${txRef}${bankRef ? ` — bank ref ${bankRef}` : ''} — ${now.toISOString()}`,
  };
  await sb.from('businesses').update(updates).eq('id', business.id);
  // subscription_events fires at admin approval/rejection
  // (replyEngine.js sub_approve_/sub_reject_), not here.

  // Telegram notifications
  const adminId = getPrimaryAdminId();
  const platformToken = process.env.TELEGRAM_BOT_TOKEN;
  if (adminId && platformToken) {
    try {
      const caption = `🟡 *Pro ${planDef.label} — review needed*\n\n*${business.name}* uploaded ${method.replace('_manual', '')} proof for ${planDef.amount} ETB.\n\nRef: \`${txRef}\`${bankRef ? `\nBank ref: \`${bankRef}\`` : ''}`;
      const replyMarkup = { inline_keyboard: [[
        { text: '✅ Approve', callback_data: `sub_approve_${business.id}` },
        { text: '❌ Reject',  callback_data: `sub_reject_${business.id}` },
      ]]};
      await fetch(`https://api.telegram.org/bot${platformToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminId,
          // documents is a private bucket: Telegram can't fetch the public URL.
          photo: await signProofUrl(sb, proofUrl, 24 * 3600),
          caption,
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) { console.warn('admin notify failed:', e.message); }
  }

  // Notify the owner — via their own bot if they have one, else the shared
  // MiniMe bot (most owners; they used to get no confirmation at all).
  if (business.telegram_bot_token_enc || platformToken) {
    try {
      const ownerToken = business.telegram_bot_token_enc ? decrypt(business.telegram_bot_token_enc) : platformToken;
      const chatId = business.owner_private_chat_id || business.owner_telegram_id;
      if (chatId) {
        const ownerText = `📨 *Payment proof received*\n\nYour Pro subscription (${planDef.label}) is *pending review*. We'll confirm within 24 hours.\n\n${await receiptBlock({ planDef, method, txRef })}`;
        await tg(ownerToken, 'sendMessage', { chat_id: chatId, text: ownerText, parse_mode: 'Markdown' });
      }
    } catch (e) { console.warn('owner notify:', e.message); }
  }

  return { status: 200, body: {
    ok: true,
    status: 'pending_review',
    proof_url: proofUrl,
    expires_at: null,
  } };
}
