/**
 * POST /api/payment/callback — Chapa pings us when a transaction settles.
 * Handles order payments (tx_ref starts with "order-").
 */
import { NextResponse } from 'next/server';
import { findByChapaRef, markPaid, update as updateOrder, decrementProductStock } from '../../../../lib/server/orders';
import { findById as findBusiness } from '../../../../lib/server/businesses';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ received: true }); }
  console.log('[chapa callback]', body);
  handleCallback(body).catch(e => console.error('chapa callback error:', e));
  return NextResponse.json({ received: true });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tx_ref = searchParams.get('tx_ref');
  const status = searchParams.get('status');
  if (tx_ref) handleCallback({ tx_ref, status }).catch(e => console.error(e));
  return NextResponse.json({ received: true });
}

async function handleCallback(body) {
  const { tx_ref, status } = body || {};
  if (!tx_ref) return;

  // Verify with Chapa (callbacks can be spoofed)
  let verifiedStatus = status;
  try {
    const r = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(tx_ref)}`, {
      headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` },
    });
    const j = await r.json();
    verifiedStatus = j?.data?.status || verifiedStatus;
  } catch (e) { console.warn('chapa verify failed:', e.message); }

  const success = String(verifiedStatus).toLowerCase() === 'success';
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

  const business = await findBusiness(order.business_id);
  if (!business) return;
  const token = await resolveBotToken(business);
  if (!token) { console.warn('[chapa] no bot token for', business.id); return; }

  const customer = order.customers || {};
  const lines = (order.items || [])
    .map(it => `  • ${it.quantity} × ${it.name} = ${Number(it.subtotal).toLocaleString()} ${order.currency}`)
    .join('\n');

  if (customer.telegram_id) {
    const isAmharic = /[\u1200-\u137F]/.test((order.items?.[0]?.name) || '');
    const text = isAmharic
      ? `✅ ክፍያ ተደረገ — አመሰግናለሁ!\n\n${lines}\n\nጠቅላላ: ${Number(order.total).toLocaleString()} ${order.currency}\n\n${business.name} ወዲያውኑ ተነግሯቸዋል።`
      : `✅ Payment received — thank you!\n\n${lines}\n\nTotal: ${Number(order.total).toLocaleString()} ${order.currency}\n\n${business.name} has been notified.`;
    await sendTelegram(token, customer.telegram_id, text).catch(e => console.warn('customer confirm failed:', e.message));
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
}

async function resolveBotToken(business) {
  if (business.telegram_bot_token_enc) {
    try { return decrypt(business.telegram_bot_token_enc); }
    catch (e) {
      console.error(`[CRITICAL] decrypt failed for business ${business.id}: ${e.message}. NOT falling back to platform bot.`);
      return null;  // Do NOT fall back to Alfred — the business has its own token that failed
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
