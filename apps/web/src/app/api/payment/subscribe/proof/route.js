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
import { decrypt } from '../../../../../lib/server/crypto';
import { tg } from '../../../../../lib/server/telegramApi';
import { logSubscriptionEvent } from '../../../../../lib/server/subscriptionEvents';
import { getSettings } from '../../../../../lib/server/platformSettings';
import { PRO_PRICE_ETB, PRO_PRICE_ANNUAL_ETB } from '../../../../../lib/plan';

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

  // Hybrid decision: monthly auto-activate, annual pending_review
  const isAnnual = plan === 'pro_annual';
  const now = new Date();
  let updates;
  if (isAnnual) {
    updates = {
      subscription_status: 'pending_review',
      payment_proof_url: proofUrl,
      payment_verified: false,
      payment_method: method,
      payment_notes: `Annual pending review — ${method} — ${txRef} — ${now.toISOString()}`,
    };
  } else {
    const expires = new Date();
    expires.setMonth(expires.getMonth() + (planDef.months || 1));
    updates = {
      subscription_status: 'active',
      plan_tier: 'pro',
      subscription_plan: 'pro',
      subscription_expires_at: expires.toISOString(),
      payment_proof_url: proofUrl,
      payment_verified: false,
      payment_method: method,
      payment_notes: `Auto-activated (monthly, awaiting spot-check) — ${method} — ${txRef} — ${now.toISOString()}`,
    };
  }
  await sb.from('businesses').update(updates).eq('id', business.id);

  // Annual goes to pending_review — its subscription_events fires at admin
  // approval/rejection (replyEngine.js sub_approve_/sub_reject_), not here.
  if (!isAnnual) {
    logSubscriptionEvent({
      businessId: business.id,
      event: 'subscribed',
      plan,
      amountEtb: planDef.amount,
      meta: { tx_ref: txRef, method, source: 'manual_proof' },
    });
  }

  // Telegram notifications
  const adminId = process.env.PLATFORM_ADMIN_TELEGRAM_ID;
  const platformToken = process.env.TELEGRAM_BOT_TOKEN;
  if (adminId && platformToken) {
    try {
      const caption = isAnnual
        ? `🟡 *Annual subscription — review needed*\n\n*${business.name}* uploaded ${method.replace('_manual', '')} proof for ${planDef.amount} ETB.\n\nRef: \`${txRef}\``
        : `🟢 *Monthly subscription — auto-activated*\n\n*${business.name}* paid ${planDef.amount} ETB via ${method.replace('_manual', '')}.\n\nRef: \`${txRef}\`\n_Spot-check if anything looks off._`;
      const replyMarkup = isAnnual
        ? { inline_keyboard: [[
            { text: '✅ Approve', callback_data: `sub_approve_${business.id}` },
            { text: '❌ Reject',  callback_data: `sub_reject_${business.id}` },
          ]]}
        : { inline_keyboard: [[{ text: '↩️ Revoke (if fake)', callback_data: `sub_reject_${business.id}` }]] };
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

  // Notify owner via their own bot (best-effort)
  if (business.telegram_bot_token_enc) {
    try {
      const ownerToken = decrypt(business.telegram_bot_token_enc);
      const chatId = business.owner_private_chat_id || business.owner_telegram_id;
      if (chatId) {
        const ownerText = isAnnual
          ? `📨 *Payment proof received*\n\nYour annual subscription is *pending review*. We'll confirm within 24 hours.\n\n${await receiptBlock({ planDef, method, txRef })}`
          : `🎉 *MiniMe Pro is now active!*\n\nYour subscription is active until *${new Date(updates.subscription_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}*.\n\n${await receiptBlock({ planDef, method, txRef, until: updates.subscription_expires_at })}`;
        await tg(ownerToken, 'sendMessage', { chat_id: chatId, text: ownerText, parse_mode: 'Markdown' });
      }
    } catch (e) { console.warn('owner notify:', e.message); }
  }

  return NextResponse.json({
    ok: true,
    status: isAnnual ? 'pending_review' : 'active',
    proof_url: proofUrl,
    expires_at: updates.subscription_expires_at || null,
  });
}
