/**
 * Order queries used by the Chapa callback route.
 */
import { supabase } from './db';
import { tg } from './telegramApi';

export async function findByChapaRef(txRef) {
  const { data } = await supabase()
    .from('orders')
    .select('*, customers(name, telegram_id, phone, email)')
    .eq('chapa_tx_ref', txRef)
    .single();
  return data;
}

export async function update(id, updates) {
  const { data, error } = await supabase().from('orders').update(updates).eq('id', id).select().single();
  if (error) { console.error('orders.update error:', error); return null; }
  return data;
}

export async function markPaid(id) {
  return update(id, { status: 'paid', paid_at: new Date().toISOString() });
}

// Default threshold: alert owner when stock drops to this level or below
// (matches DB schema default: products.low_stock_threshold DEFAULT 10)
const LOW_STOCK_THRESHOLD = 10;

/**
 * Decrement stock for a product after a successful payment.
 * Returns the updated product row.
 * Fires a low-stock Telegram alert to the owner if the new quantity is at or
 * below the threshold — uses the business's encrypted bot token automatically.
 */
export async function decrementProductStock(productId, delta, { notifyOwner = true } = {}) {
  const { data: prod } = await supabase()
    .from('products')
    .select('id, name, stock_quantity, low_stock_threshold, business_id')
    .eq('id', productId)
    .single();
  if (!prod) return null;

  const newQty = Math.max(0, (prod.stock_quantity || 0) - Math.abs(delta));
  const { data: updated } = await supabase()
    .from('products')
    .update({ stock_quantity: newQty })
    .eq('id', productId)
    .select()
    .single();

  // Fire low-stock alert if enabled and stock crossed the threshold
  const threshold = prod.low_stock_threshold ?? LOW_STOCK_THRESHOLD;
  if (notifyOwner && newQty <= threshold && (prod.stock_quantity || 0) > threshold) {
    try {
      await sendLowStockAlert(prod.business_id, prod.name, newQty, threshold);
    } catch (e) {
      console.warn('low-stock alert:', e.message);
    }
  }

  return updated;
}

/**
 * Send a low-stock Telegram notification to the owner.
 * Resolves the bot token and owner_private_chat_id from the business record.
 */
async function sendLowStockAlert(businessId, productName, currentQty, threshold) {
  const { data: biz } = await supabase()
    .from('businesses')
    .select('owner_private_chat_id, owner_telegram_id, telegram_bot_token_enc, name')
    .eq('id', businessId)
    .single();
  const chatTarget = biz?.owner_private_chat_id || biz?.owner_telegram_id;
  if (!chatTarget) return;

  let token = process.env.TELEGRAM_BOT_TOKEN;
  if (biz.telegram_bot_token_enc) {
    try {
      const { decrypt } = await import('./crypto');
      token = decrypt(biz.telegram_bot_token_enc);
    } catch {}
  }
  if (!token) return;

  const emoji = currentQty === 0 ? '🚨' : '⚠️';
  const urgency = currentQty === 0 ? 'OUT OF STOCK' : 'Low stock';
  await tg(token, 'sendMessage', {
    chat_id: chatTarget,
    text: `${emoji} *${urgency}: ${productName}*\n\nOnly *${currentQty}* left in stock (threshold: ${threshold}).\n\nReply with \`/stock\` to see all inventory levels.`,
    parse_mode: 'Markdown',
  });
}
