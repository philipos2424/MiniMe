const { supabase } = require('../client');

async function findOrCreateConversation({ business_id, customer_id }) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('business_id', business_id)
    .eq('customer_id', customer_id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('conversations')
    .insert({ business_id, customer_id })
    .select()
    .single();
  if (error) { console.error('conversations.create error:', error); return null; }
  return data;
}

async function findById(id) {
  const { data } = await supabase.from('conversations').select('*, customers(*)').eq('id', id).single();
  return data;
}

async function findByBusiness(businessId, { status, limit = 50 } = {}) {
  let q = supabase
    .from('conversations')
    .select('*, customers(*)')
    .eq('business_id', businessId)
    .order('last_message_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

async function updateConversation(id, updates) {
  const { data, error } = await supabase.from('conversations').update(updates).eq('id', id).select().single();
  if (error) { console.error('conversations.update error:', error); return null; }
  return data;
}

async function resolve(id) {
  return updateConversation(id, { status: 'resolved', resolved_at: new Date().toISOString() });
}

module.exports = { findOrCreateConversation, findById, findByBusiness, updateConversation, resolve };
