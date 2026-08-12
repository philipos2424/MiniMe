const { supabase } = require('../client');

async function insertVoiceMirror(entry) {
  const { data, error } = await supabase
    .from('voice_mirror')
    .insert(entry)
    .select()
    .single();
  if (error) { console.error('voice_mirror.insert error:', error); return null; }
  return data;
}

async function findByBusiness(businessId, { limit = 100 } = {}) {
  const { data } = await supabase
    .from('voice_mirror')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getRecentPairs(businessId, limit = 50) {
  return findByBusiness(businessId, { limit });
}

async function getCorrectionStats(businessId) {
  const { data } = await supabase
    .from('voice_mirror')
    .select('edit_distance')
    .eq('business_id', businessId);
  if (!data || data.length === 0) return { total: 0, avgEditDistance: 0 };
  const total = data.length;
  const avgEditDistance = data.reduce((sum, d) => sum + (d.edit_distance || 0), 0) / total;
  return { total, avgEditDistance: Math.round(avgEditDistance * 100) / 100 };
}

module.exports = {
  insert: insertVoiceMirror,
  findByBusiness,
  getRecentPairs,
  getCorrectionStats,
};