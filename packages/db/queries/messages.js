const { supabase } = require('../client');

async function createMessage(messageData) {
  const { data, error } = await supabase
    .from('messages')
    .insert(messageData)
    .select()
    .single();
  if (error) { console.error('messages.create error:', error); return null; }
  return data;
}

async function findById(id) {
  const { data } = await supabase.from('messages').select('*').eq('id', id).single();
  return data;
}

async function updateMessage(id, updates) {
  const { data, error } = await supabase.from('messages').update(updates).eq('id', id).select().single();
  if (error) { console.error('messages.update error:', error); return null; }
  return data;
}

async function getRecentMessages(conversationId, limit = 10) {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

async function getPendingDrafts(businessId) {
  const { data } = await supabase
    .from('messages')
    .select('*, conversations(*), customers(*)')
    .eq('business_id', businessId)
    .eq('status', 'drafted')
    .order('created_at', { ascending: false });
  return data || [];
}

async function getTodayStats(businessId) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('messages')
    .select('direction, is_ai_generated, status, ai_confidence, owner_edited')
    .eq('business_id', businessId)
    .gte('created_at', `${today}T00:00:00Z`);
  return data || [];
}

module.exports = { createMessage, findById, updateMessage, getRecentMessages, getPendingDrafts, getTodayStats };
