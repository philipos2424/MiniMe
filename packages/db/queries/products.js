const { supabase } = require('../client');

async function findByBusiness(businessId, activeOnly = true) {
  let q = supabase.from('products').select('*').eq('business_id', businessId).order('name');
  if (activeOnly) q = q.eq('is_active', true);
  const { data } = await q;
  return data || [];
}

async function findById(id) {
  const { data } = await supabase.from('products').select('*').eq('id', id).single();
  return data;
}

async function create(productData) {
  const { data, error } = await supabase.from('products').insert(productData).select().single();
  if (error) { console.error('products.create error:', error); return null; }
  return data;
}

async function update(id, updates) {
  const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single();
  if (error) { console.error('products.update error:', error); return null; }
  return data;
}

async function updateStock(id, delta) {
  const product = await findById(id);
  if (!product) return null;
  const newQty = Math.max(0, product.stock_quantity + delta);
  return update(id, { stock_quantity: newQty });
}

async function getLowStock(businessId) {
  const { data } = await supabase
    .from('products')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .filter('stock_quantity', 'lte', supabase.raw('low_stock_threshold'));
  return data || [];
}

async function deactivate(id) {
  return update(id, { is_active: false });
}

module.exports = { findByBusiness, findById, create, update, updateStock, getLowStock, deactivate };
