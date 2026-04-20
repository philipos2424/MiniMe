const { supabase } = require('../client');

async function create(orderData) {
  const { data, error } = await supabase.from('orders').insert(orderData).select().single();
  if (error) { console.error('orders.create error:', error); return null; }
  return data;
}

async function findById(id) {
  const { data } = await supabase.from('orders').select('*, customers(name, telegram_id, phone, email)').eq('id', id).single();
  return data;
}

async function findByChapaRef(txRef) {
  const { data } = await supabase
    .from('orders')
    .select('*, customers(name, telegram_id, phone, email)')
    .eq('chapa_tx_ref', txRef)
    .single();
  return data;
}

async function findByBusiness(businessId, { status, limit = 50 } = {}) {
  let q = supabase.from('orders')
    .select('*, customers(name, telegram_id)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

async function update(id, updates) {
  const { data, error } = await supabase.from('orders').update(updates).eq('id', id).select().single();
  if (error) { console.error('orders.update error:', error); return null; }
  return data;
}

async function markPaid(id) {
  return update(id, { status: 'paid', paid_at: new Date().toISOString() });
}

async function markFulfilled(id) {
  return update(id, { status: 'fulfilled', fulfilled_at: new Date().toISOString() });
}

async function markCancelled(id) {
  return update(id, { status: 'cancelled' });
}

module.exports = {
  create, findById, findByChapaRef, findByBusiness,
  update, markPaid, markFulfilled, markCancelled,
};
