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

async function getMonthly(businessId) {
  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  return getRange(businessId, start, end);
}

// Platform-wide Monthly Active Users: distinct Telegram ids that did ANYTHING
// (messaged a shop, searched, or opened the Market) in the trailing `days`.
// No single table has this — union three sources rather than adding a new
// cross-cutting "users" table just for a count.
async function getPlatformMAU(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const ids = new Set();
  try {
    const { data: activeCustomerIds } = await supabase
      .from('messages').select('customer_id')
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .not('customer_id', 'is', null);
    const custIds = [...new Set((activeCustomerIds || []).map(m => m.customer_id))];
    for (let i = 0; i < custIds.length; i += 500) {
      const { data: customers } = await supabase
        .from('customers').select('telegram_id')
        .in('id', custIds.slice(i, i + 500))
        .not('telegram_id', 'is', null);
      for (const c of customers || []) ids.add(String(c.telegram_id));
    }

    const { data: searchers } = await supabase
      .from('search_logs').select('searcher_telegram_id')
      .gte('created_at', since).not('searcher_telegram_id', 'is', null);
    for (const s of searchers || []) ids.add(String(s.searcher_telegram_id));

    const { data: marketUsers } = await supabase
      .from('market_events').select('tg_user_id')
      .gte('created_at', since).not('tg_user_id', 'is', null);
    for (const m of marketUsers || []) ids.add(String(m.tg_user_id));
  } catch (e) {
    console.error('getPlatformMAU error:', e.message);
  }
  return ids.size;
}

module.exports = { upsertDaily, getForDate, getRange, getWeekly, getMonthly, getPlatformMAU };
