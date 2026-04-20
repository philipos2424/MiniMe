const { supabase } = require('../client');

async function addMemory({ customer_id, business_id, kind, content, source = 'auto_extracted' }) {
  const { data, error } = await supabase
    .from('customer_memory')
    .upsert({ customer_id, business_id, kind, content, source }, { onConflict: 'customer_id,kind,content', ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error && !String(error.message || '').includes('duplicate')) {
    console.error('customer_memory.add error:', error);
  }
  return data;
}

async function listForCustomer(customer_id, limit = 30) {
  const { data } = await supabase
    .from('customer_memory')
    .select('*')
    .eq('customer_id', customer_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

async function listForBusiness(business_id, limit = 100) {
  const { data } = await supabase
    .from('customer_memory')
    .select('*')
    .eq('business_id', business_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

module.exports = { addMemory, listForCustomer, listForBusiness };
