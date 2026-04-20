const { supabase } = require('../client');

async function create(paymentData) {
  const { data, error } = await supabase.from('payments').insert(paymentData).select().single();
  if (error) { console.error('payments.create error:', error); return null; }
  return data;
}

async function findById(id) {
  const { data } = await supabase.from('payments').select('*').eq('id', id).single();
  return data;
}

async function findByChapaRef(txRef) {
  const { data } = await supabase.from('payments').select('*').eq('chapa_tx_ref', txRef).single();
  return data;
}

async function findByBusiness(businessId, { status, limit = 50 } = {}) {
  let q = supabase.from('payments').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

async function update(id, updates) {
  const { data, error } = await supabase.from('payments').update(updates).eq('id', id).select().single();
  if (error) { console.error('payments.update error:', error); return null; }
  return data;
}

async function getPendingFollowups(businessId) {
  const { data } = await supabase
    .from('payments')
    .select('*, customers(*)')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: true });
  return data || [];
}

async function getTodayRevenue(businessId) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('payments')
    .select('amount')
    .eq('business_id', businessId)
    .eq('status', 'completed')
    .eq('direction', 'inbound')
    .gte('created_at', `${today}T00:00:00Z`);
  return (data || []).reduce((sum, p) => sum + Number(p.amount), 0);
}

module.exports = { create, findById, findByChapaRef, findByBusiness, update, getPendingFollowups, getTodayRevenue };
