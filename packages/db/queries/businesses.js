const { supabase } = require('../client');

async function findByOwnerTelegramId(telegramId) {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_telegram_id', telegramId)
    .single();
  if (error) return null;
  return data;
}

async function findByGroupChatId(chatId) {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('business_group_chat_id', chatId)
    .single();
  if (error) return null;
  return data;
}

async function findByWebhookSecret(secret) {
  if (!secret) return null;
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('webhook_secret', secret)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function findByBotId(botId) {
  if (!botId) return null;
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('telegram_bot_id', botId)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function findById(id) {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

async function findAll() {
  const { data, error } = await supabase.from('businesses').select('*');
  if (error) return [];
  return data;
}

async function create(businessData) {
  const { data, error } = await supabase
    .from('businesses')
    .insert(businessData)
    .select()
    .single();
  if (error) { console.error('businesses.create error:', error); return null; }
  return data;
}

async function update(id, updates) {
  // Input validation
  if (updates.trust_level !== undefined) {
    const lvl = parseInt(updates.trust_level, 10);
    if (isNaN(lvl) || lvl < 0 || lvl > 3) {
      console.error('businesses.update error: invalid trust_level', updates.trust_level);
      return null;
    }
    updates.trust_level = lvl;
  }

  if (updates.subscription_status !== undefined) {
    const validStatuses = ['trial', 'active', 'expired', 'cancelled'];
    if (!validStatuses.includes(updates.subscription_status)) {
      console.error('businesses.update error: invalid subscription_status', updates.subscription_status);
      return null;
    }
  }

  const { data, error } = await supabase
    .from('businesses')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('businesses.update error:', error); return null; }
  return data;
}

async function setPanicMode(id, panicMode) {
  return update(id, {
    panic_mode: panicMode,
    panic_activated_at: panicMode ? new Date().toISOString() : null,
  });
}

async function setTrustLevel(id, level) {
  return update(id, {
    trust_level: level,
    trust_promoted_at: new Date().toISOString(),
  });
}

async function incrementOnboardingStep(id) {
  const biz = await findById(id);
  if (!biz) return null;
  return update(id, { onboarding_step: (biz.onboarding_step || 0) + 1 });
}

module.exports = {
  findByOwnerTelegramId, findByGroupChatId, findByWebhookSecret, findByBotId,
  findById, findAll,
  create, update, setPanicMode, setTrustLevel, incrementOnboardingStep,
};
