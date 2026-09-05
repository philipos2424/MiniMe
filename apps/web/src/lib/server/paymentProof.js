/**
 * Submitting proof of a subscription payment — the whole decision, in one
 * place, for every way a merchant can hand us a screenshot.
 *
 * This used to live inside api/payment/subscribe/proof/route.js, which meant
 * the only way to pay was through the Mini App: open it, copy an account
 * number by hand, leave for Telebirr, come back, type the transaction number,
 * attach the file. Merchants were already sending payment screenshots straight
 * into their bot chat — the natural thing to do — and that photo went to the
 * team-delegation handler and was dropped.
 *
 * So the money decision moved here and the route became an adapter. The bot
 * path (replyEngine) and the Mini App now reach the same rules: same
 * validation, same verify.et call, same fail-closed policy. Two doors, one
 * lock — anything else is how the two entry points drift into different
 * answers about who has paid.
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { getSettings } from './platformSettings';
import { PRO_PRICE_ETB, PRO_PRICE_ANNUAL_ETB } from '../plan';
import { verifyTransaction, isConfigured as verifyEtConfigured } from './verifyEt';
import { decide, REASON_TEXT } from './verifyEtDecision.mjs';
import { applyVerificationOutcome, logVerification } from './paymentVerification';
import { getPrimaryAdminId } from './admin';
import { isAwaitingDecision } from '../paymentLifecycle';
import { updateBusinessTolerantly } from './tolerantUpdate.mjs';

// Proof uploads set two columns that arrive by hand-run migration
// (payment_state, payment_submitted_at). Until those run, including them would
// fail the whole update and swallow a real payment — see
// lib/server/tolerantUpdate.mjs for why the payload is ranked rather than
// retried on a fixed column name.
const updateTolerantly = (sb, businessId, updates) =>
  updateBusinessTolerantly(sb, businessId, updates, { label: 'proof' });

export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = /^image\/(jpeg|png|webp|heic)$/i;

// Amounts mirror lib/plan.js (PRO_PRICE_ETB / PRO_PRICE_ANNUAL_ETB).
export const PLANS = {
  pro_monthly: { amount: PRO_PRICE_ETB, months: 1 },
  pro_annual:  { amount: PRO_PRICE_ANNUAL_ETB, months: 12 },
};

/**
 * One spelling per rail, whoever is asking.
 *
 * api/payment/subscribe writes `bank_transfer` to businesses.payment_method,
 * but the accepted list here never included that spelling — so a bank payer
 * whose method was read back off their own row was rejected as 'invalid
 * method'. Harmless while the Mini App was the only caller (it passes its own
 * literal); fatal for the bot path, which has nothing to go on BUT the stored
 * row. Normalise once, here, rather than growing the accepted list again.
 */
export function normaliseMethod(method) {
  const m = String(method || '').toLowerCase();
  if (m.startsWith('telebirr')) return 'telebirr';
  if (m.startsWith('bank') || m.startsWith('cbe')) return 'bank';
  return null;
}

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
export async function receiptBlock({ planDef, method, txRef, until }) {
  const paidAt = new Date();
  const lines = [
    '— — — — — — — — — —',
    '*RECEIPT*',
    `Item: MiniMe ${planDef.months === 12 ? 'Pro — 12 months' : 'Pro — 1 month'}`,
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

/**
 * Record a payment claim and decide what it buys.
 *
 * @param {object}  a
 * @param {object}  a.business        businesses row (must be the payer)
 * @param {Buffer}  a.buffer          the screenshot bytes
 * @param {string}  a.mime            image/jpeg | png | webp | heic
 * @param {string}  a.txRef           OUR reference; must match business.payment_ref
 * @param {string}  a.method          telebirr | bank (any known spelling)
 * @param {string} [a.plan]           pro_monthly | pro_annual
 * @param {string} [a.bankReference]  the BANK's transaction number
 * @param {string} [a.source]         'inline' (Mini App) | 'bot' — audit only
 * @returns {Promise<{httpStatus:number, body:object}>}
 */
export async function submitPaymentProof({
  business, buffer, mime, txRef, method, plan = 'pro_monthly',
  bankReference = '', source = 'inline',
}) {
  const fail = (httpStatus, error, message) => ({ httpStatus, body: message ? { error, message } : { error } });

  const rail = normaliseMethod(method);
  if (!rail) return fail(400, 'invalid method');
  if (!txRef) return fail(400, 'tx_ref required');
  if (!buffer?.length) return fail(400, 'file required');

  // Verify the tx_ref matches a pending payment for this business
  if (business.payment_ref !== txRef) {
    return fail(400, 'tx_ref mismatch — please restart the payment flow');
  }

  if (!ALLOWED_MIME.test(mime || '')) {
    return fail(415, `Screenshot must be a JPEG/PNG/WebP image (got ${mime || 'unknown'})`);
  }
  if (buffer.length > MAX_BYTES) {
    return fail(413, 'Screenshot too large (10 MB max)');
  }

  const bankRef = String(bankReference || '').trim();
  const planDef = PLANS[plan] || PLANS.pro_monthly;
  const ext = (mime || 'image/jpeg').split('/')[1] || 'jpg';
  const storagePath = `payment-proofs/${business.id}/${txRef}.${ext}`;
  const sb = supabase();

  const { error: upErr } = await sb.storage.from('documents').upload(storagePath, buffer, {
    contentType: mime,
    upsert: true,
  });
  if (upErr) {
    console.error('payment proof upload failed:', upErr.message);
    return fail(500, `Upload failed: ${upErr.message}`);
  }
  const { data: pub } = sb.storage.from('documents').getPublicUrl(storagePath);
  const proofUrl = pub?.publicUrl;

  // When the current review opened. Queue ageing only — it has no effect on
  // entitlement, so a merchant re-uploading cannot buy themselves anything by
  // refreshing it. That was not always true: while payment progress lived in
  // subscription_status, this timestamp gated a hold on the shop's expiry, and
  // re-stamping it on every upload handed that cap to the person it capped.
  const reviewOpenedAt = (isAwaitingDecision(business) && business.payment_submitted_at)
    ? business.payment_submitted_at
    : new Date().toISOString();

  // ── Automated verification (verify.et) ─────────────────────────────────────
  // Policy: verify first, then activate. The screenshot is kept as evidence but
  // is no longer what grants access — it never proved anything. When verify.et
  // is configured this decides the outcome for BOTH plans; the old hybrid
  // (monthly on trust, annual by eyeball) only applies when it isn't.
  if (await verifyEtConfigured()) {
    const expectedEtb = planDef.amount;

    if (!bankRef) {
      return fail(400, 'bank_reference_required',
        'Enter the transaction number from your Telebirr receipt or CBE SMS so we can confirm the payment automatically.');
    }

    // Refuse a reference already used by a DIFFERENT business before spending a
    // verification credit — one real receipt must not unlock two subscriptions.
    const { data: reused } = await sb.from('payment_verifications')
      .select('business_id').eq('bank_reference', bankRef).eq('accepted', true)
      .neq('business_id', business.id).limit(1);
    if (reused?.length) {
      await logVerification({
        business_id: business.id, method: rail, bank_reference: bankRef, our_reference: txRef,
        state: 'failed', accepted: false, reason: 'reference_already_used',
        expected_etb: expectedEtb, source,
      });
      return fail(409, 'reference_already_used',
        'That transaction number has already been used for another subscription.');
    }

    // Persist what the async path will need before the call — a webhook can
    // arrive before this request finishes.
    await sb.from('businesses').update({
      payment_bank_ref: bankRef,
      payment_method: rail,
      payment_proof_url: proofUrl,
      verifyet_expected_etb: expectedEtb,
      verifyet_plan: plan,
    }).eq('id', business.id);

    const webUrl = process.env.WEB_URL || '';
    const result = await verifyTransaction({
      method: rail,
      reference: bankRef,
      // Same merchant + same bank reference is the same verification, however
      // many times a flaky connection makes them hit Submit.
      idempotencyKey: `${business.id}:${bankRef}`,
      webhookUrl: webUrl ? `${webUrl}/api/payment/verify-et/webhook` : null,
    });

    if (result.ok && result.state === 'queued') {
      // Still running. Park it — the webhook (or a later poll) finishes the job.
      // Note what is NOT here: subscription_status. A queued verification is a
      // fact about the payment, not about the shop's access, and the shop keeps
      // whatever access it already had until a decision is actually reached.
      await updateTolerantly(sb, business.id, {
        payment_state: 'verifying',
        payment_verified: false,
        verifyet_request_id: result.requestId || null,
        payment_notes: `Awaiting verify.et — ${rail} — bank ref ${bankRef} — ${new Date().toISOString()}`,
        payment_submitted_at: reviewOpenedAt,
      });
      await logVerification({
        business_id: business.id, method: rail, bank_reference: bankRef, our_reference: txRef,
        request_id: result.requestId || null, state: 'queued', accepted: false, reason: 'queued',
        expected_etb: expectedEtb, source, raw: result.raw || null,
      });
      return {
        httpStatus: 200,
        body: {
          ok: true, status: 'verifying',
          message: 'Checking your payment with the bank — this usually takes a few seconds. We\'ll message you the moment it clears.',
        },
      };
    }

    const verdict = decide(result, { expectedEtb });
    const outcome = await applyVerificationOutcome({
      business: { ...business, verifyet_expected_etb: expectedEtb, payment_bank_ref: bankRef },
      result, verdict, plan, method: rail, bankReference: bankRef, source,
    });

    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: outcome.activated ? 'active' : 'in_review',
        verified: outcome.activated,
        reason: outcome.activated ? null : (REASON_TEXT[verdict.reason] || verdict.reason),
        retryable: outcome.activated ? false : !!verdict.retryable,
        proof_url: proofUrl,
      },
    };
  }

  // ── Fallback: no verify.et configured ──────────────────────────────────────
  //
  // Review first, then activate — for BOTH plans.
  //
  // This used to auto-activate monthly plans the instant an image landed, on
  // the reasoning that a screenshot plus a spot-check was good enough for a
  // small amount. It isn't a check of anything: nothing here reads the image,
  // compares an amount, or confirms money moved. A photo of a wall granted a
  // month of Pro, and the "spot-check" was an admin noticing later among
  // hundreds of accounts — which is precisely how ~600 shops ended up on Pro
  // with no payment behind any of them.
  //
  // subscription_events fires at approval, not here: nothing has been sold yet.
  const isAnnual = plan === 'pro_annual';
  const now = new Date();
  await updateTolerantly(sb, business.id, {
    payment_state: 'in_review',
    payment_proof_url: proofUrl,
    payment_verified: false,
    payment_method: rail,
    payment_notes: `Awaiting review (${isAnnual ? 'annual' : 'monthly'}) — ${rail} — ${txRef} — ${now.toISOString()}`,
    // WHICH plan is being paid for. The approval handler extends the
    // subscription by the term recorded here; without it monthly and annual
    // are indistinguishable at approval time and a 1,999 ETB payment would buy
    // whatever the handler happens to assume.
    verifyet_plan: plan,
    // Ages the review queue (see cron/stale-reviews). Nothing about the shop's
    // access depends on it.
    payment_submitted_at: reviewOpenedAt,
  });

  // Telegram notifications
  const adminId = getPrimaryAdminId();
  const platformToken = process.env.TELEGRAM_BOT_TOKEN;
  if (adminId && platformToken) {
    try {
      // One caption, one pair of buttons, both plans. Nothing is active yet, so
      // there is no "revoke if fake" variant any more — the decision happens
      // here, before access, instead of after it.
      const caption =
        `🟡 *${isAnnual ? 'Annual' : 'Monthly'} subscription — review needed*\n\n` +
        `*${business.name}* uploaded ${rail} proof for ${planDef.amount} ETB.\n\n` +
        `Ref: \`${txRef}\`${bankRef ? `\nBank ref: \`${bankRef}\`` : ''}\n\n` +
        `_Check the amount and the reference against your account before approving._`;
      await fetch(`https://api.telegram.org/bot${platformToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminId,
          photo: proofUrl,
          caption,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[
            { text: '✅ Approve', callback_data: `sub_approve_${business.id}` },
            { text: '❌ Reject',  callback_data: `sub_reject_${business.id}` },
          ]]},
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) { console.warn('admin notify failed:', e.message); }
  }

  // Tell the owner we have it.
  //
  // Sent from the PLATFORM bot, not the shop's own bot. This was gated on
  // `business.telegram_bot_token_enc`, so a merchant who never linked their own
  // bot uploaded a screenshot and then heard absolutely nothing back — on the
  // one screen where silence reads as "it didn't work". Every owner has a chat
  // with @MiniMeAgentBot from onboarding, so this always has somewhere to land.
  if (platformToken) {
    try {
      const chatId = business.owner_private_chat_id || business.owner_telegram_id;
      if (chatId) {
        const ownerText =
          `📨 *Payment proof received*\n\n` +
          `Thanks — we're checking it against our account now and will confirm here, ` +
          `usually within 24 hours. No need to send it again.\n\n` +
          `${await receiptBlock({ planDef, method: rail, txRef })}`;
        await tg(platformToken, 'sendMessage', { chat_id: chatId, text: ownerText, parse_mode: 'Markdown' });
      }
    } catch (e) { console.warn('owner notify:', e.message); }
  }

  return { httpStatus: 200, body: { ok: true, status: 'in_review', proof_url: proofUrl, expires_at: null } };
}
