/**
 * GET /api/cron/payment-followups — payments nobody has finished.
 *
 *   1. Customer orders: the customer tapped "I've paid" (Telebirr / CBE) and
 *      the owner hasn't pressed Confirm or Not yet for 2 hours → remind the
 *      owner once, with the customer's screenshot attached when there is one.
 *   2. Subscription proofs queued at verify.et: poll each one; settle it when
 *      verify.et has answered, otherwise after 30 minutes hand it to a human
 *      (admin gets Approve / Reject on Telegram, owner is told).
 *
 * Runs a few times a day (vercel.json), so both are accurate to a few hours.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';
import { notifyOwnerPaymentClaim, PAYMENT_REMINDER_AFTER_MS } from '../../../../lib/server/orderPayments';
import { settleQueuedVerifications } from '../../../../lib/server/paymentVerification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const now = new Date();
  const reminders = await remindUnconfirmedPayments(now).catch(e => ({ error: e.message }));
  const verifications = await settleQueuedVerifications({ now }).catch(e => ({ error: e.message }));
  return NextResponse.json({ ok: true, reminders, verifications });
}

async function remindUnconfirmedPayments(now) {
  const sb = supabase();
  const cutoff = new Date(now.getTime() - PAYMENT_REMINDER_AFTER_MS).toISOString();
  const { data: orders, error } = await sb.from('orders')
    .select('id, business_id, conversation_id, customer_id, total, currency, status, payment_method, meta, created_at, customers(name, telegram_username)')
    .eq('status', 'pending_payment')
    .not('meta->>payment_claimed_at', 'is', null)
    .lt('meta->>payment_claimed_at', cutoff)
    .is('meta->>payment_reminded_at', null)
    .limit(100);
  if (error) return { error: error.message };
  if (!orders?.length) return { reminded: 0 };

  const ids = [...new Set(orders.map(o => o.business_id))];
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc')
    .in('id', ids);
  const byId = new Map((businesses || []).map(b => [b.id, b]));
  const platformToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim() || null;

  let reminded = 0;
  for (const order of orders) {
    const business = byId.get(order.business_id);
    if (!business) continue;
    let token = platformToken;
    if (business.telegram_bot_token_enc) {
      try { token = decrypt(business.telegram_bot_token_enc); } catch {}
    }
    const sent = await notifyOwnerPaymentClaim({ token, business, order, customer: order.customers, reminder: true, sb });
    // Stamp even when Telegram refused, so a blocked bot isn't retried every run.
    await sb.from('orders').update({ meta: { ...(order.meta || {}), payment_reminded_at: now.toISOString() } }).eq('id', order.id);
    if (sent?.ok) reminded++;
  }
  return { reminded, due: orders.length };
}
