/**
 * POST /api/payment/subscribe/proof
 * Owner uploads a Telebirr/CBE payment screenshot. We:
 *   1. Validate FormData (file + tx_ref + method + plan)
 *   2. Verify tx_ref matches the business's pending payment_ref
 *   3. Upload screenshot to documents bucket at payment-proofs/<biz>/<txref>.<ext>
 *   4. Decide hybrid approval:
 *      - Monthly (≤ PRO_PRICE_ETB plan_def.amount) → auto-activate, payment_verified=false
 *      - Annual (> PRO_PRICE_ETB) → subscription_status='pending_review'
 *   5. Notify platform admin via Telegram with screenshot + Approve/Reject buttons (annual)
 *      or just-FYI alert (monthly)
 *   6. Notify owner via Telegram with confirmation
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { tg } from '../../../../../lib/server/telegramApi';
import { getSettings } from '../../../../../lib/server/platformSettings';
import { PRO_PRICE_ETB, PRO_PRICE_ANNUAL_ETB } from '../../../../../lib/plan';
import { verifyTransaction, isConfigured as verifyEtConfigured } from '../../../../../lib/server/verifyEt';
import { decide, REASON_TEXT } from '../../../../../lib/server/verifyEtDecision.mjs';
import { applyVerificationOutcome, logVerification } from '../../../../../lib/server/paymentVerification';
import { getPrimaryAdminId } from '../../../../../lib/server/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
 * Write the row, retrying without payment_submitted_at if that column isn't
 * there yet.
 *
 * The column arrives with supabase/migrations/payment_submitted_at.sql. Until
 * that runs, including it fails the WHOLE update — which would leave a merchant
 * who just paid with no proof recorded and no pending_review, i.e. silently
 * swallowing a real payment. The hold is a nicety; recording the payment is
 * not, so the hold is what gets dropped.
 */
async function updateTolerantly(sb, businessId, updates) {
  const { error } = await sb.from('businesses').update(updates).eq('id', businessId);
  if (!error) return;
  if (!('payment_submitted_at' in updates)) throw new Error(error.message);

  console.warn('[proof] payment_submitted_at unavailable, retrying without the review hold:', error.message);
  const { payment_submitted_at, ...rest } = updates;
  const { error: retryErr } = await sb.from('businesses').update(rest).eq('id', businessId);
  if (retryErr) throw new Error(retryErr.message);
}

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(jpeg|png|webp|heic)$/i;

// Amounts mirror lib/plan.js (PRO_PRICE_ETB / PRO_PRICE_ANNUAL_ETB).
const PLANS = {
  pro_monthly: { amount: PRO_PRICE_ETB, months: 1 },
  pro_annual:  { amount: PRO_PRICE_ANNUAL_ETB, months: 12 },
};

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let form;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 }); }

  const file = form.get('file');
  const txRef = form.get('tx_ref');
  const method = form.get('method');
  const plan = form.get('plan') || 'pro_monthly';

  if (!file || typeof file === 'string') return NextResponse.json({ error: 'file required' }, { status: 400 });
  if (!txRef) return NextResponse.json({ error: 'tx_ref required' }, { status: 400 });
  // 'bank'/'bank_manual' is the current name; 'cbe*' kept for older clients.
  if (!['telebirr', 'telebirr_manual', 'bank', 'bank_manual', 'cbe', 'cbe_manual'].includes(method)) {
    return NextResponse.json({ error: 'invalid method' }, { status: 400 });
  }

  // Verify the tx_ref matches a pending payment for this business
  if (business.payment_ref !== txRef) {
    return NextResponse.json({ error: 'tx_ref mismatch — please restart the payment flow' }, { status: 400 });
  }

  const mime = file.type || '';
  if (!ALLOWED_MIME.test(mime)) {
    return NextResponse.json({ error: `Screenshot must be a JPEG/PNG/WebP image (got ${mime || 'unknown'})` }, { status: 415 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Screenshot too large (10 MB max)' }, { status: 413 });
  }

  // The BANK's transaction number, off the merchant's SMS or receipt. Distinct
  // from tx_ref, which is our own SUB-XXXXXX invoice code — verify.et has never
  // heard of that one, so without this field nothing can be checked.
  const bankRef = String(form.get('bank_reference') || '').trim();

  const planDef = PLANS[plan] || PLANS.pro_monthly;
  const ext = mime.split('/')[1] || 'jpg';
  const storagePath = `payment-proofs/${business.id}/${txRef}.${ext}`;
  const sb = supabase();

  const { error: upErr } = await sb.storage.from('documents').upload(storagePath, buf, {
    contentType: mime,
    upsert: true,
  });
  if (upErr) {
    console.error('payment proof upload failed:', upErr.message);
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
  }
  const { data: pub } = sb.storage.from('documents').getPublicUrl(storagePath);
  const proofUrl = pub?.publicUrl;

  // When the CURRENT review cycle started — not when this particular upload
  // happened.
  //
  // payment_submitted_at freezes the shop's plan expiry while we decide, capped
  // at REVIEW_HOLD_DAYS so a review nobody actions cannot become permanent
  // access. Stamping it on every upload handed that cap to the merchant: submit
  // any image, get a fresh 14 days, resubmit on day 13, hold the expiry open
  // forever without ever paying. The cap has to be anchored to something the
  // person being capped cannot reset.
  //
  // So an upload that lands while a review is ALREADY outstanding keeps the
  // original anchor. Approval and rejection clear the field, so a genuinely new
  // payment after a decision correctly starts a fresh cycle.
  const reviewAnchor = (business.subscription_status === 'pending_review' && business.payment_submitted_at)
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
      return NextResponse.json({
        error: 'bank_reference_required',
        message: 'Enter the transaction number from your Telebirr receipt or CBE SMS so we can confirm the payment automatically.',
      }, { status: 400 });
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
      return NextResponse.json({
        error: 'reference_already_used',
        message: 'That transaction number has already been used for another subscription.',
      }, { status: 409 });
    }

    // Persist what the async path will need before the call — a webhook can
    // arrive before this request finishes.
    await sb.from('businesses').update({
      payment_bank_ref: bankRef,
      payment_method: method,
      payment_proof_url: proofUrl,
      verifyet_expected_etb: expectedEtb,
      verifyet_plan: plan,
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
      // Same hold as the manual path: a queued verification is still our time,
      // not the merchant's, so their expiry freezes from this moment too.
      await updateTolerantly(sb, business.id, {
        subscription_status: 'pending_review',
        payment_verified: false,
        verifyet_request_id: result.requestId || null,
        payment_notes: `Awaiting verify.et — ${method} — bank ref ${bankRef} — ${new Date().toISOString()}`,
        payment_submitted_at: reviewAnchor,
      });
      await logVerification({
        business_id: business.id, method, bank_reference: bankRef, our_reference: txRef,
        request_id: result.requestId || null, state: 'queued', accepted: false, reason: 'queued',
        expected_etb: expectedEtb, source: 'inline', raw: result.raw || null,
      });
      return NextResponse.json({
        ok: true, status: 'verifying',
        message: 'Checking your payment with the bank — this usually takes a few seconds. We\'ll message you the moment it clears.',
      });
    }

    const verdict = decide(result, { expectedEtb });
    const outcome = await applyVerificationOutcome({
      business: { ...business, verifyet_expected_etb: expectedEtb, payment_bank_ref: bankRef },
      result, verdict, plan, method, bankReference: bankRef, source: 'inline',
    });

    return NextResponse.json({
      ok: true,
      status: outcome.activated ? 'active' : 'pending_review',
      verified: outcome.activated,
      reason: outcome.activated ? null : (REASON_TEXT[verdict.reason] || verdict.reason),
      retryable: outcome.activated ? false : !!verdict.retryable,
      proof_url: proofUrl,
    });
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
  // With verify.et unconfigured there is no automated evidence available, so
  // the only honest gate is a human looking at the screenshot. The
  // Approve/Reject buttons already exist for annual (replyEngine.js
  // sub_approve_/sub_reject_) and now cover monthly too — one path, one
  // decision, no plan that skips the gate.
  //
  // subscription_events fires at approval, not here: nothing has been sold yet.
  const isAnnual = plan === 'pro_annual';
  const now = new Date();
  const updates = {
    subscription_status: 'pending_review',
    payment_proof_url: proofUrl,
    payment_verified: false,
    payment_method: method,
    payment_notes: `Awaiting review (${isAnnual ? 'annual' : 'monthly'}) — ${method} — ${txRef} — ${now.toISOString()}`,
    // WHICH plan is being paid for. The approval handler extends the
    // subscription by the term recorded here; without it monthly and annual
    // are indistinguishable at approval time and a 1,999 ETB payment would buy
    // whatever the handler happens to assume. (Column is named for verify.et
    // because that path introduced it, but it means the same thing on both
    // routes: the plan this pending payment is for.)
    verifyet_plan: plan,
    // Freezes the shop's expiry while we decide — planStatus() judges dates as
    // they stood when the review cycle opened, so our review time never costs
    // the merchant days they paid for. See REVIEW_HOLD_DAYS in lib/plan.js and
    // the reviewAnchor note above for why this is not simply `now`.
    payment_submitted_at: reviewAnchor,
  };
  await updateTolerantly(sb, business.id, updates);

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
        `*${business.name}* uploaded ${method.replace('_manual', '')} proof for ${planDef.amount} ETB.\n\n` +
        `Ref: \`${txRef}\`${bankRef ? `\nBank ref: \`${bankRef}\`` : ''}\n\n` +
        `_Check the amount and the reference against your account before approving._`;
      const replyMarkup = { inline_keyboard: [[
        { text: '✅ Approve', callback_data: `sub_approve_${business.id}` },
        { text: '❌ Reject',  callback_data: `sub_reject_${business.id}` },
      ]]};
      await fetch(`https://api.telegram.org/bot${platformToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminId,
          photo: proofUrl,
          caption,
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
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
          `${await receiptBlock({ planDef, method, txRef })}`;
        await tg(platformToken, 'sendMessage', { chat_id: chatId, text: ownerText, parse_mode: 'Markdown' });
      }
    } catch (e) { console.warn('owner notify:', e.message); }
  }

  return NextResponse.json({
    ok: true,
    status: 'pending_review',
    proof_url: proofUrl,
    expires_at: null,
  });
}
