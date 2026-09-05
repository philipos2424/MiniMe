/**
 * POST /api/payment/subscribe/proof
 *
 * Owner uploads a Telebirr/CBE payment screenshot from the Mini App. This route
 * does the three things only an HTTP entry point can do — authenticate the
 * caller, parse the multipart body, shape a JSON response — and hands the money
 * decision to lib/server/paymentProof.js.
 *
 * That split exists because the Mini App is no longer the only way in: a
 * merchant who sends the screenshot straight to their bot chat reaches the same
 * function from replyEngine. Validation, verify.et, and the verify-first policy
 * live there so the two paths cannot answer differently about who has paid.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { submitPaymentProof } from '../../../../../lib/server/paymentProof';

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
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'file required' }, { status: 400 });

  const { httpStatus, body } = await submitPaymentProof({
    business,
    buffer: Buffer.from(await file.arrayBuffer()),
    mime: file.type || '',
    txRef: form.get('tx_ref'),
    method: form.get('method'),
    plan: form.get('plan') || 'pro_monthly',
    // The BANK's transaction number, off the merchant's SMS or receipt.
    // Distinct from tx_ref, which is our own MM-XXXXXX invoice code —
    // verify.et has never heard of that one, so without this field nothing
    // can be checked.
    bankReference: form.get('bank_reference') || '',
    source: 'inline',
  });

  return NextResponse.json(body, { status: httpStatus });
}
