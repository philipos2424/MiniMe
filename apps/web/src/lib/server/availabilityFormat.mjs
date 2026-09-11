/**
 * Availability — the pure half: arithmetic and prompt wording.
 *
 * Split out of availability.js so node:test can import it; that file needs the
 * Supabase client, which arrives through an extensionless import only the Next
 * bundler resolves. See availability.js for what a hold is and why.
 */

/**
 * Attach held_quantity / available_quantity to each product.
 *
 * `exceptHeld` discounts the requesting customer's OWN active holds, so someone
 * adjusting their own pending order isn't blocked by it.
 */
export function annotateAvailability(products, held = {}, exceptHeld = {}) {
  return (products || []).map(p => {
    const stock = p.stock_quantity;
    const rawHeld = Math.max(0, (Number(held[p.id]) || 0) - (Number(exceptHeld[p.id]) || 0));
    // A product with no stock tracking (null) stays untracked — inventing a
    // number here would turn "we don't count this" into "we have none".
    if (stock == null) return { ...p, held_quantity: rawHeld, available_quantity: null };
    const heldQty = Math.min(rawHeld, stock);
    return { ...p, held_quantity: heldQty, available_quantity: Math.max(0, stock - heldQty) };
  });
}

function split(p) {
  const stock = p?.stock_quantity;
  const held = Math.min(Math.max(0, Number(p?.held_quantity) || 0), stock ?? Infinity);
  const available = p?.available_quantity != null ? p.available_quantity : Math.max(0, (stock ?? 0) - held);
  return { stock, held, available };
}

/** What a single product has left, for a customer-facing prompt line. */
export function formatStock(p) {
  const { stock, held, available } = split(p);
  if (stock == null) return '';
  if (stock <= 0) return 'out of stock';
  if (held <= 0) return `stock: ${stock}`;
  if (available <= 0) return `all ${stock} on hold for other customers right now — none free`;
  return `stock: ${stock} (${held} on hold — ${available} available now)`;
}

/** Same thing, compressed for the fast path's one-line catalog. */
export function formatStockCompact(p) {
  const { stock, held, available } = split(p);
  if (stock == null) return '';
  if (stock <= 0) return ' [OUT]';
  if (held <= 0) return '';
  if (available <= 0) return ` [all ${stock} on hold]`;
  return ` [${available} free, ${held} on hold]`;
}

/**
 * Prompt rules for talking about holds. Only emitted when something is actually
 * held, so the common case costs nothing.
 *
 * The disclosure limit is the important half: how many, never who. A customer
 * asking about a product must not be able to learn anything about the customer
 * holding it.
 */
export function holdsPromptBlock(products) {
  const anyHeld = (products || []).some(p => (p.held_quantity || 0) > 0);
  if (!anyHeld) return '';
  return `
# STOCK & HOLDS
Some items are on hold: another customer has an unpaid order for them. The catalog shows total stock, how many are held, and how many are actually free.
- Quote what is AVAILABLE NOW, never the total, when the two differ.
- You may say how many are on hold ("2 are on hold right now, 1 still free"). NEVER say who holds them, when they ordered, what they paid, or anything else about another customer.
- If everything is held, say so honestly and offer to let them know when one frees up — holds expire.`;
}
