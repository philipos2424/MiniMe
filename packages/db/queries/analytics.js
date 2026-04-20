const { supabase } = require('../client');

async function upsertDaily(businessId, date, stats) {
  const { data, error } = await supabase
    .from('daily_analytics')
    .upsert({ business_id: businessId, date, ...stats }, { onConflict: 'business_id,date' })
    .select()
    .single();
  if (error) { console.error('analytics.upsert error:', error); return null; }
  return data;
}

async function getForDate(businessId, date) {
  const { data } = await supabase.from('daily_analytics').select('*').eq('business_id', businessId).eq('date', date).single();
  return data;
}

async function getRange(businessId, startDate, endDate) {
  const { data } = await supabase
    .from('daily_analytics')
    .select('*')
    .eq('business_id', businessId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });
  return data || [];
}

async function getWeekly(businessId) {
  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  return getRange(businessId, start, end);
}

module.exports = { upsertDaily, getForDate, getRange, getWeekly };
