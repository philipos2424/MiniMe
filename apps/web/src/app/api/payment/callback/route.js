/**
 * POST /api/payment/callback — Chapa pings us when a transaction settles.
 * Handles order payments (tx_ref starts with "order-").
 */
import { NextResponse } from 'next/server';
import { findByChapaRef, markPaid, update as updateOrder, decrementProductStock } from '../../../../lib/server/orders';
import { findById as findBusiness } from '../../../../lib/server/businesses';
import { decrypt } from '../../../../lib/server/crypto';
import { logSubscriptionEvent } from '../../../../lib/server/subscriptionEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ received: true }); }
  // Fire-and-forget but log errors
  handleCallback(body, 'POST').catch(e => console.error('[chapa callback]', e.message));
  return NextResponse.json({ received: true });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tx_ref = searchParams.get('tx_ref');
  if (tx_ref) handleCallback({ tx_ref }, 'GET').catch(e => console.error('[chapa GET callback]', e.message));
  return NextResponse.json({ received: true });
}

async function handleCallback(body, source) {
  const { tx_ref } = body || {};
  if (!tx_ref) return;

  // MANDATORY verification with Chapa — never trust the request body status.
  // If Chapa API is unreachable, we abort and let Chapa retry later.
  if (!process.env.CHAPA_SECRET_KEY) {
    console.error('[chapa] CHAPA_SECRET_KEY not set — cannot verify payment');
    return;
  }
  let verifiedPayment;
  try {
    const r = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(tx_ref)}`, {
      headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    if (!r.ok) {
      console.warn(`[chapa] verify returned ${r.status} for ${tx_ref}:`, j);
      return; // Don't process — Chapa will retry
    }
    verifiedPayment = j?.data || {};
  } catch (e) {
    console.warn('[chapa] verification network error for', tx_ref, e.message);
    return; // Don't process — abort, Chapa will retry
  }

  if (!verifiedPayment.status) {
    console.warn('[chapa] no status in verify response for', tx_ref);
    return;
  }

  const success = String(verifiedPayment.status).toLowerCase() === 'success';

  // ── Subscription payment (tx_ref starts with "sub-") ──────────────────────
  if (tx_ref.startsWith('sub-')) {
    if (!success) { console.warn('[chapa sub] payment not successful:', tx_ref); return; }
    const { supabase } = await import('../../../../lib/server/db');
    const sb = supabase();
    const { data: biz } = await sb.from('businesses')
      .select('id, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, name, payment_ref')
      .eq('payment_ref', tx_ref).maybeSingle();
    if (!biz) { console.warn('[chapa sub] no business for tx_ref', tx_ref); return; }

    // Determine subscription duration from tx_ref suffix (sub-<bizId8>-<ts>)
    // We always extend from today (or current expiry if in the future)
    const { data: cur } = await sb.from('businesses')
      .select('subscription_expires_at, subscription_status').eq('id', biz.id).single();
    const base = cur?.subscription_expires_at && new Date(cur.subscription_expires_at) > new Date()
      ? new Date(cur.subscription_expires_at) : new Date();

    // Detect annual vs monthly only from Chapa's verified amount, never from the callback body.
    const verifiedAmount = Number(verifiedPayment.amount || 0);
    const months = verifiedAmount >= 20000 ? 12 : 1;
    base.setMonth(base.getMonth() + months);

    await sb.from('businesses').update({
      subscription_status: 'active',
      plan_tier: 'pro',
      subscription_plan: 'pro',
      subscription_expires_at: base.toISOString(),
      payment_notes: `Paid via Chapa — ${tx_ref} — ${new Date().toISOString()}`,
    }).eq('id', biz.id);

    logSubscriptionEvent({
      businessId: biz.id,
      event: cur?.subscription_status === 'active' ? 'renewed' : 'subscribed',
      plan: months === 12 ? 'pro_annual' : 'pro_monthly',
      amountEtb: verifiedAmount,
      meta: { tx_ref, source: 'chapa' },
    });

    // Notify owner via Telegram
    const chatId = biz.owner_private_chat_id || biz.owner_telegram_id;
    if (chatId && biz.telegram_bot_token_enc) {
      try {
        const { decrypt } = await import('../../../../lib/server/crypto');
        const token = decrypt(biz.telegram_bot_token_enc);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎉 *MiniMe Pro activated!*\n\nYour subscription is active until *${base.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}*.\n\nRef: \`${tx_ref}\``,
            parse_mode: 'Markdown',
          }),
        });
      } catch {}
    }
    return;
  }

  if (!tx_ref.startsWith('order-')) return; // Only handle customer orders here

  const order = await findByChapaRef(tx_ref);
  if (!order) { console.warn('[chapa] no order for', tx_ref); return; }
  if (!success) {
    await updateOrder(order.id, { status: 'cancelled', owner_note: 'Payment failed or cancelled' });
    return;
  }
  if (order.status === 'paid' || order.status === 'fulfilled') return;

  await markPaid(order.id);

  for (const item of order.items || []) {
    try { if (item.product_id) await decrementProductStock(item.product_id, item.quantity || 0); }
    catch (e) { console.warn('stock update failed:', e.message); }
  }

  // ── Update customer loyalty points and lifetime stats ─────────────────────
  if (order.customer_id) {
    try {
      const { supabase: _sbLoy } = await import('../../../../lib/server/db');
      const sb = _sbLoy();
      const { data: cust } = await sb.from('customers')
        .select('loyalty_points, total_orders, total_spent')
        .eq('id', order.customer_id)
        .single();
      if (cust) {
        // Award 1 loyalty point per 10 ETB spent (rounded down)
        const earned = Math.floor(Number(order.total || 0) / 10);
        const newPts = (cust.loyalty_points || 0) + earned;
        const newOrders = (cust.total_orders || 0) + 1;
        const newSpent = Number((cust.total_spent || 0)) + Number(order.total || 0);
        const newTier = newPts >= 500 ? 'gold' : newPts >= 100 ? 'silver' : 'bronze';
        await sb.from('customers').update({
          loyalty_points: newPts,
          total_orders: newOrders,
          total_spent: newSpent,
          tier: newTier,
          last_active_at: new Date().toISOString(),
        }).eq('id', order.customer_id);
      }
    } catch (e) { console.warn('loyalty update failed:', e.message); }
  }

  const business = await findBusiness(order.business_id);

  // ── Check if this is the first ever paid order (first-sale milestone) ────
  let isFirstSale = false;
  try {
    const { supabase: _sb2 } = await import('../../../../lib/server/db');
    const { count } = await _sb2().from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', order.business_id)
      .in('status', ['paid', 'fulfilled']);
    isFirstSale = (count || 0) <= 1; // This order just got marked paid, so <=1 means it's the first
  } catch (e) { console.warn('[first-sale check]', e.message); }
  if (!business) return;
  const token = await resolveBotToken(business);
  if (!token) { console.warn('[chapa] no bot token for', business.id); return; }

  const customer = order.customers || {};
  const lines = (order.items || [])
    .map(it => `  • ${it.quantity} × ${it.name} = ${Number(it.subtotal).toLocaleString()} ${order.currency}`)
    .join('\n');

  const baseUrl = (process.env.WEB_URL || 'https://minime.bot').replace(/\/$/, '');
  const receiptUrl = `${baseUrl}/receipt/${order.id}`;

  if (customer.telegram_id) {
    const isAmharic = /[ሀ-፿]/.test((order.items?.[0]?.name) || '');
    const receiptLink = isAmharic ? `[📄 ደረሰኝ ይመልከቱ](${receiptUrl})` : `[📄 View your receipt](${receiptUrl})`;
    const text = isAmharic
      ? `✅ ክፍያ ተደረገ — አመሰግናለሁ!

${lines}

ጠቅላላ: ${Number(order.total).toLocaleString()} ${order.currency}

${business.name} ወዲያውኑ ተነግሯቸዋል።

${receiptLink}`
      : `✅ Payment received — thank you!

${lines}

Total: ${Number(order.total).toLocaleString()} ${order.currency}

${business.name} has been notified.

${receiptLink}`;
    await sendTelegram(token, customer.telegram_id, text, { parse_mode: 'Markdown' }).catch(e => console.warn('customer confirm failed:', e.message));

    // Mark receipt auto-sent
    try {
      const { supabase: _sb } = await import('../../../../lib/server/db');
      await _sb().from('orders').update({
        meta: { ...(order.meta || {}), receipt_sent_at: new Date().toISOString(), receipt_auto: true },
      }).eq('id', order.id);
    } catch {}
  }

  if (business.owner_private_chat_id) {
    const text = `💰 *Payment received*\n\n*${customer.name || 'Customer'}*${customer.telegram_id ? ` · [open chat](tg://user?id=${customer.telegram_id})` : ''}\n\n${lines}\n\n*Total: ${Number(order.total).toLocaleString()} ${order.currency}*`;
    await sendTelegram(token, business.owner_private_chat_id, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Mark fulfilled', callback_data: `order_fulfill_${order.id}` },
          { text: '↩️ Refund', callback_data: `order_refund_${order.id}` },
        ]],
      },
    }).catch(e => console.warn('owner ping failed:', e.message));
  }

  // ── First-sale milestone celebration DM ───────────────────────────────────
  if (isFirstSale && business?.owner_private_chat_id) {
    const customerName = customer.name || 'your first customer';
    const amount = `${Number(order.total || 0).toLocaleString()} ${order.currency || 'ETB'}`;
    const celebText = `🎉 *Congratulations — your first sale!*\n\n*${amount}* from *${customerName}*.\n\nYou're officially in business. Keep going — the next one is easier. 💪\n\n_MiniMe is here every step of the way._`;
    sendTelegram(token, business.owner_private_chat_id, celebText, { parse_mode: 'Markdown' })
      .catch(() => {});
  }
}

async function resolveBotToken(business) {
  if (business.telegram_bot_token_enc) {
    try { return decrypt(business.telegram_bot_token_enc); }
    catch (e) {
      console.error(`[CRITICAL] decrypt failed for business ${business.id}: ${e.message}. NOT falling back to platform bot.`);
      // Notify platform admin about the failure so it doesn't go unnoticed
      const adminId = process.env.PLATFORM_ADMIN_TELEGRAM_ID;
      const platformToken = process.env.TELEGRAM_BOT_TOKEN;
      if (adminId && platformToken) {
        fetch(`https://api.telegram.org/bot${platformToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: adminId, text: `⚠️ [CRITICAL] decrypt failed for business ${business.id} (${business.name || 'unknown'}). Payment notification may have been lost.` }),
        }).catch(() => {});
      }
      return null;
    }
  }
  // No custom token stored → business uses the platform bot (Alfred). Legitimate.
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

async function sendTelegram(token, chatId, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...extra }),
  });
  if (!r.ok) throw new Error(`telegram ${r.status}`);
  return r.json();
}
