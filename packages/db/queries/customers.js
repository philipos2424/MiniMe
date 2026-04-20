const { supabase } = require('../client');

async function findOrCreateCustomer({ business_id, telegram_id, telegram_username, name }) {
  const { data: existing } = await supabase
    .from('customers')
    .select('*')
    .eq('business_id', business_id)
    .eq('telegram_id', telegram_id)
    .single();

  if (existing) {
    await supabase.from('customers').update({ last_active_at: new Date().toISOString(), telegram_username, name: name || existing.name }).eq('id', existing.id);
    return existing;
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({ business_id, telegram_id, telegram_username, name })
    .select()
    .single();
  if (error) { console.error('customers.create error:', error); return null; }
  return data;
}

async function findById(id) {
  const { data } = await supabase.from('customers').select('*').eq('id', id).single();
  return data;
}

async function findByBusiness(businessId, { limit = 50, tier } = {}) {
  let q = supabase.from('customers').select('*').eq('business_id', businessId).order('last_active_at', { ascending: false }).limit(limit);
  if (tier) q = q.eq('tier', tier);
  const { data } = await q;
  return data || [];
}

async function update(id, updates) {
  const { data, error } = await supabase.from('customers').update(updates).eq('id', id).select().single();
  if (error) { console.error('customers.update error:', error); return null; }
  return data;
}

async function updateTier(id, totalOrders, totalSpent) {
  let tier = 'new';
  if (totalOrders >= 10 || totalSpent >= 20000) tier = 'vip';
  else if (totalOrders >= 3) tier = 'regular';
  return update(id, { tier, total_orders: totalOrders, total_spent: totalSpent });
}

async function getTopCustomers(businessId, limit = 5) {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('business_id', businessId)
    .order('total_spent', { ascending: false })
    .limit(limit);
  return data || [];
}

module.exports = { findOrCreateCustomer, findById, findByBusiness, update, updateTier, getTopCustomers };
