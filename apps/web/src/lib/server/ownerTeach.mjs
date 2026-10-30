/**
 * Teaching MiniMe and adding products from the owner's chat (pure, no I/O).
 *
 * Two gaps this closes:
 *   - The owner agent had no tool for business facts or new products. "We
 *     deliver on Saturdays" or "add red dress 1500 birr" got a friendly
 *     `reply` ("Got it!") and nothing was saved. The old learnFromOwnerChat
 *     fallback in replyEngine never runs, because handleOwnerPrompt always
 *     reports that it replied.
 *   - A photo the owner sent (not forwarded) was only read into knowledge.
 *     It never became a product, even with "Red dress 1500 birr" as the
 *     caption. Only forwarded posts did.
 */

// No \b after the unit: \b is ASCII-only, so it never matches after ብር.
const PRICE_RE = /(\d[\d,]*(?:\.\d+)?)\s*(etb|birr|br|ብር)(?![a-z])|(?:etb|birr|ብር)\s*(\d[\d,]*(?:\.\d+)?)/i;
// Words that say "this photo is something I sell" (English and Amharic).
const SELL_RE = /\b(add|new|product|selling|for sale|sell|price|stock|available)\b|(አዲስ|ዋጋ|ይሸጣል|ለሽያጭ|አለን|ምርት)/i;
// Captions that say the photo is NOT a product.
const NOT_PRODUCT_RE = /\b(menu|price.?list|catalog|portfolio|brochure|receipt|screenshot|invoice|stock|inventory|restock)\b/i;

/** First price written in the text, as a number, or null. */
export function priceIn(text) {
  const m = String(text || '').match(PRICE_RE);
  if (!m) return null;
  const n = Number(String(m[1] || m[3]).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Should an owner photo with this caption be added as a product straight away?
 * Yes when the caption names a price or says it's for sale, and isn't one of
 * the file/stock captions that other handlers own.
 */
export function captionWantsProduct(caption) {
  const c = String(caption || '').trim();
  if (!c || NOT_PRODUCT_RE.test(c)) return false;
  return priceIn(c) != null || SELL_RE.test(c);
}

/** The photo itself shows a price (from Vision text) — worth offering "Add as product". */
export function photoLooksLikeProduct(visionText) {
  return priceIn(visionText) != null;
}

/** Validate add_product tool arguments. */
export function validateNewProduct({ name, price, stock } = {}) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (clean.length < 2) return { ok: false, error: 'Which product? Tell me its name.' };
  const p = Number(String(price ?? '').replace(/,/g, ''));
  if (!Number.isFinite(p) || p <= 0) return { ok: false, error: `What's the price of *${clean}*?` };
  let s = null;
  if (stock !== undefined && stock !== null && stock !== '') {
    s = Math.floor(Number(stock));
    if (!Number.isFinite(s) || s < 0) s = null;
  }
  return { ok: true, product: { name: clean, price: p, stock: s } };
}

/** Owner confirmation after a product was created. */
export function productAddedText({ name, price, stock, currency = 'ETB' }, { hasPhoto = false } = {}) {
  const lines = [`✅ *${name}* is in your catalog — ${Number(price).toLocaleString()} ${currency}${stock != null ? ` · ${stock} in stock` : ''}.`];
  lines.push('Customers can ask about it and order it now.');
  if (!hasPhoto) lines.push('', '📸 Send a photo with the caption _' + name + '_ to add a picture.');
  return lines.join('\n');
}

/** Owner confirmation after a business fact was saved. */
export function factSavedText(fact) {
  return `💡 Saved: _${String(fact).slice(0, 200)}_\n\nI'll use this when customers ask.`;
}

/** Text for a photo that was added as one or more products (created or refreshed). */
export function photoProductsText(products) {
  const fmt = p => `• *${p.name}*${p.price != null ? ` — ${Number(p.price).toLocaleString()} ETB` : ''}`;
  return [
    `🛍️ *In your catalog now, with this photo:*`,
    ...products.slice(0, 8).map(fmt),
    products.length > 8 ? `…and ${products.length - 8} more` : null,
    '',
    'Customers can ask about it and order it. Wrong name or price? Just tell me, e.g. _"change ' + (products[0]?.name || 'it') + ' to 1200"_.',
  ].filter(l => l !== null).join('\n');
}
