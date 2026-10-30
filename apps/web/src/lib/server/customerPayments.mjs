/**
 * How a customer pays a shop for an order (pure, no I/O).
 *
 * There is no Chapa account: manual Telebirr and CBE transfers are the main
 * path. Two live bugs came from assuming Chapa:
 *   - tryCheckout() cancelled every order when generateChapaLink() returned
 *     null ("Chapa link failed") and never told the owner;
 *   - payments defaulted to { chapa: true }, so shops that never chose Chapa
 *     were treated as if they had.
 * Chapa is now offered only when the platform has a key AND the shop turned it
 * on. Telebirr uses the same "I've paid → owner Confirm / Not yet" flow as CBE
 * (callbacks pay_telebirr_ / cbe_sent_ / cbe_confirm_ / cbe_reject_).
 */
import { starsForEtb } from '../starsRate.mjs';

/** Which methods a shop can offer right now. `chapaKey` is the platform key (or null). */
export function enabledMethods(pmts, { chapaKey = null } = {}) {
  const p = pmts || {};
  return {
    chapa: !!chapaKey && p.chapa === true,
    stars: !!p.telegram_stars,
    cbe: !!(p.cbe_manual && String(p.cbe_account || '').trim()),
    telebirr: !!(p.telebirr_manual && String(p.telebirr_phone || '').trim()),
  };
}

export function hasManualMethod(m) {
  return !!(m.cbe || m.telebirr);
}

/** payment_method stored on an order when the customer picks (or only has) one rail. */
export function manualMethodFor(m) {
  if (m.cbe && !m.telebirr) return 'cbe_manual';
  if (m.telebirr && !m.cbe) return 'telebirr_manual';
  return 'manual';
}

export function methodLabel(paymentMethod) {
  if (paymentMethod === 'telebirr_manual') return 'Telebirr';
  if (paymentMethod === 'cbe_manual') return 'CBE';
  return 'bank or Telebirr';
}

/** Short reference the customer puts on the transfer. */
export function orderRef(order) {
  return String(order?.id || 'NOREF').slice(0, 8).toUpperCase();
}

/** Markdown lines with the shop's enabled Telebirr / CBE details. */
export function manualPaymentLines(pmts, m) {
  const p = pmts || {};
  const lines = [];
  if (m.telebirr) {
    lines.push(`📱 *Telebirr:* \`${String(p.telebirr_phone).trim()}\`${p.telebirr_name ? ` (${p.telebirr_name})` : ''}`);
  }
  if (m.cbe) {
    lines.push(`🏦 *CBE:* \`${String(p.cbe_account).trim()}\`${p.cbe_name ? ` (${p.cbe_name})` : ''}`);
  }
  return lines;
}

/**
 * Inline keyboard rows for an order's payment message (agentBrain create_order).
 * `chapaUrl` only when a Chapa link was actually created.
 */
export function orderPayButtons({ order, pmts, methods, total, currency, chapaUrl = null }) {
  const rows = [];
  if (chapaUrl) rows.push([{ text: '💳 Pay with Chapa', url: chapaUrl }]);
  if (methods.stars && currency === 'ETB') {
    rows.push([{ text: `⭐ Pay ${starsForEtb(total, pmts?.stars_per_etb).toLocaleString()} Stars`, callback_data: `pay_stars_${order.id}` }]);
  }
  if (methods.telebirr) rows.push([{ text: '📱 Pay via Telebirr', callback_data: `pay_telebirr_${order.id}` }]);
  if (methods.cbe) rows.push([{ text: '🏦 Pay via CBE transfer', callback_data: `pay_cbe_${order.id}` }]);
  return rows;
}

/** The "I've paid" button that hands the claim to the owner. */
export function paidButton(order) {
  return [{ text: "✓ I've paid", callback_data: `cbe_sent_${order.id}` }];
}

// ── Unpaid-order follow-ups (cron/payment-followups) ─────────────────────────
// Before, nothing followed up an order nobody paid for: the cron only reminded
// owners about "I've paid" claims, and even that never ran (orders.meta was
// missing — migration 064).

export const MANUAL_METHODS = ['cbe_manual', 'telebirr_manual', 'manual'];
export const CUSTOMER_NUDGE_AFTER_MS = 3 * 60 * 60 * 1000;   // 3 hours
export const OWNER_NUDGE_AFTER_MS = 24 * 60 * 60 * 1000;     // 1 day
export const STOP_FOLLOWING_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** Order is waiting on a Telebirr / CBE transfer the customer hasn't claimed yet. */
export function awaitingManualPayment(order, now = new Date()) {
  if (!order || order.status !== 'pending_payment') return false;
  if (!MANUAL_METHODS.includes(order.payment_method)) return false;
  if (order.meta?.payment_claimed_at) return false;
  const age = now.getTime() - new Date(order.created_at).getTime();
  return age >= 0 && age < STOP_FOLLOWING_AFTER_MS;
}

/**
 * Which follow-up an unpaid order needs now: 'customer' (one reminder after
 * 3h), 'owner' (one heads-up after a day), or null.
 */
export function unpaidFollowUpDue(order, now = new Date()) {
  if (!awaitingManualPayment(order, now)) return null;
  const age = now.getTime() - new Date(order.created_at).getTime();
  const meta = order.meta || {};
  // Customer first, always — the owner text says they were already reminded.
  if (age >= CUSTOMER_NUDGE_AFTER_MS && !meta.customer_nudged_at) return 'customer';
  if (age >= OWNER_NUDGE_AFTER_MS && meta.customer_nudged_at && !meta.owner_nudged_at) return 'owner';
  return null;
}

function itemsLine(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const s = items.slice(0, 4).map(it => `${it.quantity || 1}× ${it.name}`).join(', ');
  return items.length > 4 ? `${s}…` : s;
}

/** Reminder to the customer. Plain Markdown; pay buttons go with it. */
export function customerPaymentNudgeText({ businessName, order }) {
  const amount = `${Number(order.total).toLocaleString()} ${order.currency || 'ETB'}`;
  const items = itemsLine(order);
  return [
    `👋 A quick reminder from *${businessName}*`,
    '',
    `Your order${items ? ` (${items})` : ''} — *${amount}* — is still waiting for payment.`,
    `Reference: \`${orderRef(order)}\``,
    '',
    `Already paid? Tap *I've paid* or send the screenshot here.`,
    `ትዕዛዝዎ ክፍያ እየጠበቀ ነው። ከከፈሉ «I've paid» ይጫኑ ወይም ደረሰኙን እዚህ ይላኩ።`,
  ].join('\n');
}

/** Heads-up to the owner that an order is still unpaid after a day. */
export function ownerUnpaidText({ customerName, order }) {
  const amount = `${Number(order.total).toLocaleString()} ${order.currency || 'ETB'}`;
  const items = itemsLine(order);
  return [
    `⏳ *Still unpaid:* ${customerName || 'A customer'} — ${amount}${items ? ` (${items})` : ''}`,
    `Ref \`${orderRef(order)}\`, ordered a day ago. I already reminded them once.`,
    '',
    'Message them, or cancel the order if it’s not happening.',
  ].join('\n');
}
