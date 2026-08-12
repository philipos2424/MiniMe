const { supabase } = require('../client');

async function create(leadCardData) {
  const { data, error } = await supabase
    .from('lead_cards')
    .insert(leadCardData)
    .select()
    .single();
  if (error) { console.error('lead_cards.create error:', error); return null; }
  return data;
}

async function findById(id) {
  const { data } = await supabase.from('lead_cards').select('*').eq('id', id).single();
  return data;
}

async function findByBusiness(businessId, { status, limit = 50 } = {}) {
  let q = supabase
    .from('lead_cards')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

async function findPendingByBusiness(businessId, limit = 50) {
  return findByBusiness(businessId, { status: 'pending', limit });
}

async function updateLeadCard(id, updates) {
  const { data, error } = await supabase
    .from('lead_cards')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('lead_cards.update error:', error); return null; }
  return data;
}

async function approveLeadCard(id, ownerResponse = 'YES') {
  return updateLeadCard(id, {
    status: 'approved',
    owner_response: ownerResponse,
    approved_at: new Date().toISOString(),
  });
}

async function rejectLeadCard(id, reason) {
  return updateLeadCard(id, {
    status: 'rejected',
    owner_response: reason,
  });
}

async function markLeadCardSent(id) {
  return updateLeadCard(id, {
    status: 'approved',
    sent_at: new Date().toISOString(),
  });
}

async function getExpiredLeadCards(businessId) {
  const { data } = await supabase
    .from('lead_cards')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString());
  return data || [];
}

module.exports = {
  create,
  findById,
  findByBusiness,
  findPendingByBusiness,
  update: updateLeadCard,
  approve: approveLeadCard,
  reject: rejectLeadCard,
  markSent: markLeadCardSent,
  getExpired: getExpiredLeadCards,
};