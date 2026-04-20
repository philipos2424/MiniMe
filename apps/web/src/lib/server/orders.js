/**
 * Order queries used by the Chapa callback route.
 */
import { supabase } from './db';

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

export async function decrementProductStock(productId, delta) {
  const { data: prod } = await supabase().from('products').select('id, stock_quantity').eq('id', productId).single();
  if (!prod) return null;
  const newQty = Math.max(0, (prod.stock_quantity || 0) - Math.abs(delta));
  const { data } = await supabase().from('products').update({ stock_quantity: newQty }).eq('id', productId).select().single();
  return data;
}
