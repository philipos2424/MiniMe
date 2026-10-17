/**
 * "💰 Sold" — the owner records a sale that closed in chat.
 *
 * Most sales on MiniMe close in conversation and get paid in cash, Telebirr
 * or a bank transfer, so the orders table (Chapa checkout only) held 17 rows
 * ever and GMV read as ~0. One tap on a customer card asks "how much?", and
 * the reply becomes a paid manual order linked to that customer and chat —
 * which the nightly rollup, Insights and the owner's weekly digest already
 * count.
 *
 * Same force_reply pattern as ✏️ Edit: the prompt starts with a sentinel plus
 * the conversation id, so no server-side session state is needed.
 */
export const SALE_PROMPT_PREFIX = '💰 Record sale ';
export const SOLD_CALLBACK = 'sold_';
const MAX_AMOUNT = 10_000_000;

export function salePrompt(conversationId, customerName) {
  return `${SALE_PROMPT_PREFIX}${conversationId}\n\n` +
    `How much did ${customerName || 'this customer'} pay? Reply with the amount in birr — e.g. 1200.`;
}

/** Conversation id from the prompt the owner replied to, or null. */
export function saleConversationId(replyToText) {
  if (!String(replyToText || '').startsWith(SALE_PROMPT_PREFIX)) return null;
  const id = replyToText.slice(SALE_PROMPT_PREFIX.length).split(/\s/)[0].trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * Amount in birr from what an owner types: "1200", "1,200", "1 200 birr",
 * "ETB 1200.50", "1.5k". Null when there's no single sensible amount.
 */
export function parseSaleAmount(text) {
  const s = String(text || '').toLowerCase().replace(/(\d)[,\s](?=\d{3}\b)/g, '$1');
  if (/-\s*\d/.test(s)) return null; // a refund or a typo, not a sale
  const m = s.match(/(\d+(?:\.\d+)?)\s*(k)?\b/);
  if (!m) return null;
  if ((s.match(/\d+(?:\.\d+)?/g) || []).length > 1) return null; // "2 for 600" — ask again
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}

/** Row for public.orders: a paid, owner-reported sale. */
export function manualSaleOrder({ business, conversation, amount, now = new Date() }) {
  const at = now.toISOString();
  return {
    business_id: business.id,
    customer_id: conversation.customer_id || null,
    conversation_id: conversation.id,
    items: [],
    subtotal: amount,
    total: amount,
    currency: business.currency || 'ETB',
    status: 'paid',
    paid_at: at,
    payment_method: 'owner_reported',
    source: 'manual',
    expires_at: null,
    owner_note: 'Recorded by the owner with 💰 Sold',
  };
}

export function saleRecordedText(amount, customerName) {
  return `✅ Recorded a ${amount.toLocaleString('en-US')} birr sale${customerName ? ` with ${customerName}` : ''}.\n\n` +
    `It counts in your weekly summary. Tap 💰 Sold on any chat to record the next one.`;
}
