/**
 * Format a customer/supplier mention as a tappable Telegram-Markdown link.
 * Tapping opens that person's profile or chat directly.
 *
 * Priority:
 *   1. tg://user?id=<numeric>   — opens chat with that user (works for any id)
 *   2. https://t.me/<username>  — opens their profile
 *   3. Plain bold name           — fallback
 *
 * Markdown V1 ([text](url)) — works in our existing parse_mode: 'Markdown' flow.
 */

function escapeName(name) {
  // Keep it readable; Markdown link text can include almost anything except
  // unbalanced brackets. Strip those defensively.
  return (name || 'Unknown').replace(/[\[\]]/g, '');
}

export function customerMention(customer, opts = {}) {
  if (!customer) return 'a customer';
  const display = escapeName(customer.name || customer.telegram_username || 'Unknown');
  if (customer.telegram_id) return `[${display}](tg://user?id=${customer.telegram_id})`;
  if (customer.telegram_username) return `[${display}](https://t.me/${String(customer.telegram_username).replace(/^@/, '')})`;
  return `*${display}*`;
}

export function supplierMention(supplier, opts = {}) {
  if (!supplier) return 'a team member';
  const display = escapeName(supplier.name || supplier.telegram_username || 'Unknown');
  if (supplier.contact_telegram) return `[${display}](tg://user?id=${supplier.contact_telegram})`;
  if (supplier.telegram_username) return `[${display}](https://t.me/${String(supplier.telegram_username).replace(/^@/, '')})`;
  return `*${display}*`;
}

/**
 * Build a one-line "from:" header for owner notifications about a customer.
 * Example: "From [Sara Haile](tg://user?id=123) · @sara · regular · 4 visits"
 */
export function customerHeader(customer) {
  if (!customer) return '';
  const parts = [`From ${customerMention(customer)}`];
  if (customer.telegram_username) parts.push(`@${customer.telegram_username}`);
  if (customer.tier && customer.tier !== 'new') parts.push(customer.tier);
  if (customer.total_orders) parts.push(`${customer.total_orders} order${customer.total_orders === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
