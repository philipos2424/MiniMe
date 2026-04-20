const { supabase } = require('../client');

async function findByBusiness(businessId) {
  const { data } = await supabase
    .from('suppliers')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('reliability_score', { ascending: false });
  return data || [];
}

async function findById(id) {
  const { data } = await supabase.from('suppliers').select('*').eq('id', id).single();
  return data;
}

async function findByTelegram(telegramId) {
  const { data } = await supabase
    .from('suppliers')
    .select('*')
    .eq('contact_telegram', telegramId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return data;
}

async function findByName(businessId, name) {
  const { data } = await supabase
    .from('suppliers')
    .select('*')
    .eq('business_id', businessId)
    .ilike('name', name)
    .maybeSingle();
  return data;
}

async function create(supplierData) {
  const { data, error } = await supabase
    .from('suppliers')
    .insert(supplierData)
    .select()
    .single();
  if (error) { console.error('suppliers.create error:', error); return null; }
  return data;
}

async function update(id, updates) {
  const { data, error } = await supabase
    .from('suppliers')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('suppliers.update error:', error); return null; }
  return data;
}

async function getBestForProduct(businessId, productName) {
  const { data } = await supabase
    .from('suppliers')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .contains('products_supplied', [productName])
    .order('reliability_score', { ascending: false })
    .limit(3);
  return data || [];
}

module.exports = { findByBusiness, findById, findByTelegram, findByName, create, update, getBestForProduct };
