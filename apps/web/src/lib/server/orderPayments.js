/**
 * Manual (Telebirr / CBE) order payments: the owner's side.
 *
 * When a customer taps "I've paid", the owner gets Confirm / Not yet buttons,
 * with the customer's latest screenshot attached when there is one, so they
 * can check it against their Telebirr or CBE app without hunting through the
 * chat. If they don't answer, cron/payment-followups reminds them once.
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { getSetting } from './platformSettings';
import { methodLabel, orderRef } from './customerPayments.mjs';

export const PAYMENT_REMINDER_AFTER_MS = 2 * 60 * 60 * 1000;

/** The platform Chapa key (DB setting, else CHAPA_SECRET_KEY), or null. */
export async function chapaKey() {
  try { return (await getSetting('gateway.chapa.secret')) || null; }
  catch { return process.env.CHAPA_SECRET_KEY || null; }
}

/** file_id of the newest photo the customer sent in this order's chat since it was placed. */
export async function latestReceiptFileId(order, sb = supabase()) {
  if (!order?.conversation_id) return null;
  const { data } = await sb.from('messages')
    .select('telegram_file_id')
    .eq('conversation_id', order.conversation_id)
    .eq('direction', 'inbound')
    .eq('content_type', 'image')
    .not('telegram_file_id', 'is', null)
    .gte('created_at', order.created_at)
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0]?.telegram_file_id || null;
}

/**
 * Send the owner a payment claim to confirm. `reminder` changes the wording
 * only. Returns the Telegram result.
 */
export async function notifyOwnerPaymentClaim({ token, business, order, customer, reminder = false, sb = supabase() }) {
  const chatId = business.owner_private_chat_id || business.owner_telegram_id;
  if (!chatId || !token) return null;
  const label = methodLabel(order.payment_method);
  const who = `${customer?.name || 'Customer'}${customer?.telegram_username ? ' @' + customer.telegram_username : ''}`;
  const amount = `${Number(order.total).toLocaleString()} ${order.currency || 'ETB'}`;
  const head = reminder
    ? `⏰ *Still waiting for you to confirm a payment*`
    : `💰 *Payment claimed (${label})*`;
  const receipt = await latestReceiptFileId(order, sb).catch(() => null);
  const text = [
    head,
    '',
    `${who} says they sent ${amount}, ref \`${orderRef(order)}\`.`,
    receipt ? 'Their screenshot is attached.' : 'No screenshot yet.',
    '',
    `Check your ${label} app, then confirm:`,
  ].join('\n');
  const reply_markup = {
    inline_keyboard: [[
      { text: '✓ Confirm received', callback_data: `cbe_confirm_${order.id}` },
      { text: '✗ Not yet', callback_data: `cbe_reject_${order.id}` },
    ]],
  };
  if (receipt) {
    const sent = await tg(token, 'sendPhoto', { chat_id: chatId, photo: receipt, caption: text, parse_mode: 'Markdown', reply_markup });
    if (sent?.ok) return sent;
  }
  return tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', reply_markup });
}

/**
 * Tell the owner about a new order that's waiting for payment. Used by
 * agentBrain create_order, whose orders used to reach the owner only if the
 * model also happened to call notify_owner. Same wording and buttons as the
 * tryCheckout notice in replyEngine. `extraLines` carries delivery details.
 */
export async function notifyOwnerNewOrder({ token, business, customer, lines, total, currency, methods, chapaUrl, ref, extraLines = [] }) {
  const chatId = business.owner_private_chat_id || business.owner_telegram_id;
  if (!chatId || !token) return null;
  const kb = [[{ text: '💬 Reply to customer', callback_data: `odm_${customer.id}` }]];
  if (customer.telegram_username) {
    kb.push([{ text: `👤 Open direct chat with @${customer.telegram_username}`, url: `https://t.me/${customer.telegram_username}` }]);
  }
  const appBase = (process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || '').trim().replace(/\/$/, '');
  if (appBase) kb.push([{ text: '📱 View in MiniMe', web_app: { url: `${appBase}/orders` } }]);
  const manualNames = [methods?.telebirr && 'Telebirr', methods?.cbe && 'CBE'].filter(Boolean);
  const payStatus = chapaUrl
    ? 'They were sent a Chapa payment link.'
    : manualNames.length
      ? `They were offered ${manualNames.join(' and ')} (ref \`${ref}\`). You'll get Confirm / Not yet buttons when they say they've paid.`
      : 'They were offered Telegram Stars.';
  const extra = extraLines.filter(Boolean).join('\n');
  return tg(token, 'sendMessage', {
    chat_id: chatId,
    text: `🛒 *New order — awaiting payment*\n\n*${customer.name || 'Customer'}*\n${lines}${extra ? `\n${extra}` : ''}\n\n*Total: ${Number(total).toLocaleString()} ${currency}*\n\n${payStatus}`,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: kb },
  });
}

/**
 * Edit the owner's claim message after Confirm / Not yet. It is a photo when a
 * receipt was attached, and editMessageText fails on photos.
 */
export async function editClaimMessage(token, message, text) {
  if (!message) return;
  const base = { chat_id: message.chat?.id, message_id: message.message_id, parse_mode: 'Markdown' };
  if (message.photo) await tg(token, 'editMessageCaption', { ...base, caption: text });
  else await tg(token, 'editMessageText', { ...base, text });
}
