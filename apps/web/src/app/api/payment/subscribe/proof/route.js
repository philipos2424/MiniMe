/**
 * POST /api/payment/subscribe/proof
 * Owner uploads a Telebirr/CBE payment screenshot. We:
 *   1. Validate FormData (file + tx_ref + method + plan)
 *   2. Verify tx_ref matches the business's pending payment_ref
 *   3. Upload screenshot to documents bucket at payment-proofs/<biz>/<txref>.<ext>
 *   4. Verify with verify.et when configured; otherwise every period goes to
 *      subscription_status='pending_review' (nothing activates on a screenshot)
 *   5. Notify platform admin via Telegram with screenshot + Approve/Reject buttons
 *   6. Notify owner via Telegram with confirmation
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { PRO_PERIODS } from '../../../../../lib/plan';
import { submitSubscriptionProof, MAX_BYTES, ALLOWED_MIME } from '../../../../../lib/server/subscriptionProof';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const { status, body } = await submitSubscriptionProof({ business, buf, mime, txRef, method, plan, bankRef });
  return NextResponse.json(body, { status });
}
