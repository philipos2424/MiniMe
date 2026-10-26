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
