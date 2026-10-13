import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../../lib/server/admin';
import { supabase } from '../../../../../../lib/server/db';
import { reviewSubscriptionPayment } from '../../../../../../lib/server/paymentReview.mjs';
import { audit } from '../../../../../../lib/server/audit';
import { logSubscriptionEvent } from '../../../../../../lib/server/subscriptionEvents';
import { sendTelegramMessage } from '../../../../../../lib/server/telegram-send.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  if (!['approve', 'reject'].includes(body?.action) || typeof body.expected_ref !== 'string' || !body.expected_ref || body.expected_ref.length > 200) {
    return NextResponse.json({ error: 'Action and payment reference are required' }, { status: 400 });
  }
  let result;
  try {
    result = await reviewSubscriptionPayment(supabase(), {
      businessId: params.id, action: body.action, expectedRef: body.expected_ref, period: body.period,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: /^Could not/.test(e.message) ? 503 : 409 });
  }
  const { business, period } = result;
  if (body.action === 'approve' && result.prior_status === 'pending_review') logSubscriptionEvent({ businessId: params.id, event: 'subscribed',
    plan: period?.key, amountEtb: period?.amount, meta: { tx_ref: body.expected_ref, source: 'admin_review' } });
  await audit({ business_id: params.id, actor_type: 'platform_admin', actor_id: String(admin.id),
    action: `payment.${body.action === 'approve' ? 'approved' : 'rejected'}`, resource_type: 'business', resource_id: params.id,
    metadata: { reference: body.expected_ref, period: period?.key || null, expires_at: business.subscription_expires_at }, request }).catch(() => {});
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = business.owner_private_chat_id || business.owner_telegram_id;
  if (token && chatId) await sendTelegramMessage(token, { chat_id: chatId,
    text: body.action === 'approve'
      ? `Payment approved. MiniMe Pro is active until ${new Date(business.subscription_expires_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Addis_Ababa' })}. Thank you!`
      : 'We could not verify your payment. Please contact support or try again from Settings → Billing.',
  }).catch(() => {});
  return NextResponse.json({ ok: true, expires_at: business.subscription_expires_at }, { headers: { 'Cache-Control': 'no-store' } });
}
