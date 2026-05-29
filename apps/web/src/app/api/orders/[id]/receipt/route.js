/**
 * POST /api/orders/[id]/receipt — Send a receipt to the customer via Telegram.
 * The receipt includes a link to a public printable HTML page they can "Save as PDF".
 *
 * GET /api/orders/[id]/receipt — Return a JSON receipt payload (used by the
 * public printable page at /receipt/[id], which is unauthenticated).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser, findById as findBusinessById } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { decrypt } from '../../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildReceiptText({ business, order }) {
  const items = Array.isArray(order.items) ? order.items : [];
  const isAmharic = /[ሀ-፿]/.test(business?.name || '') ||
                    items.some(it => /[ሀ-፿]/.test(it.name || ''));
  const cur = order.currency || 'ETB';
  const total = Number(order.total || 0).toLocaleString();
  const orderNum = order.id.slice(-6).toUpperCase();
  const paidDate = order.paid_at
    ? new Date(order.paid_at).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';
  const lineItems = items
    .map(it => {
      const name = it.name || it.product || 'Item';
      const qty = it.qty || it.quantity || 1;
      const sub = (it.price ?? 0) * qty || it.subtotal || 0;
      return `  • ${qty} × ${name} = ${Number(sub).toLocaleString()} ${cur}`;
    })
    .join('\n');

  if (isAmharic) {
    return `🧾 *ደረሰኝ — ${business?.name || 'ንግድ'}*

ቁጥር: \`${orderNum}\`
ቀን: ${paidDate}

${lineItems}

*ጠቅላላ: ${total} ${cur}*

ስለ ግዢዎ እናመሰግናለን! 🙏`;
  }
  return `🧾 *Receipt — ${business?.name || 'Business'}*

Order: \`${orderNum}\`
Paid: ${paidDate}

${lineItems}

*Total: ${total} ${cur}*

Thank you for your purchase! 🙏`;
}

async function sendTelegram(token, chatId, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'Markdown',
      disable_web_page_preview: false, ...extra,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`telegram ${r.status}`);
  return r.json();
}

function publicReceiptUrl(request, id) {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host');
  const base = (process.env.WEB_URL || `${proto}://${host}`).replace(/\/$/, '');
  return `${base}/receipt/${id}`;
}

/** Send the receipt to the customer over Telegram (owner-initiated). */
export async function POST(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const { data: order } = await sb.from('orders')
    .select('*, customers(id, name, telegram_id)')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!order.customers?.telegram_id) {
    return NextResponse.json({ error: 'customer_no_telegram' }, { status: 400 });
  }

  let token;
  if (business.telegram_bot_token_enc) {
    try { token = decrypt(business.telegram_bot_token_enc); }
    catch { token = process.env.TELEGRAM_BOT_TOKEN; }
  } else {
    token = process.env.TELEGRAM_BOT_TOKEN;
  }
  if (!token) return NextResponse.json({ error: 'no_bot_token' }, { status: 500 });

  const text = buildReceiptText({ business, order });
  const url = publicReceiptUrl(request, order.id);

  try {
    await sendTelegram(token, order.customers.telegram_id, `${text}\n\n[📄 Open printable receipt](${url})`);
  } catch (e) {
    return NextResponse.json({ error: 'telegram_send_failed', detail: e.message }, { status: 502 });
  }

  // Mark receipt sent so the UI can reflect it
  await sb.from('orders').update({
    meta: { ...(order.meta || {}), receipt_sent_at: new Date().toISOString() },
  }).eq('id', order.id);

  return NextResponse.json({ ok: true, url });
}

/** Public read used by /receipt/[id] page (no auth). */
export async function GET(request, { params }) {
  const sb = supabase();
  const { data: order } = await sb.from('orders')
    .select('id, business_id, items, total, currency, paid_at, created_at, status, customers(name)')
    .eq('id', params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const business = await findBusinessById(order.business_id);
  if (!business) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    business: {
      name: business.name,
      category: business.category,
      telegram_bot_username: business.telegram_bot_username,
      phone: business.phone || null,
    },
    order: {
      id: order.id,
      items: order.items || [],
      total: order.total,
      currency: order.currency || 'ETB',
      paid_at: order.paid_at,
      created_at: order.created_at,
      status: order.status,
      customer_name: order.customers?.name || null,
    },
  });
}
