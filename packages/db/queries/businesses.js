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

/**
 * Platform-wide social proof for the bot's upgrade prompts: how many businesses
 * have signed up, and how many replies MiniMe has written for them.
 * Mirrors apps/web/src/lib/server/socialProof.js — keep the metric, the floors
 * and the exactness identical, because the bot and the app quoting different
 * counts to the same owner in the same minute reads as made up.
 *
 * LIVE and EXACT. Never hardcode a bigger figure here — one invented number and
 * none of the rest are evidence.
 */
const SOCIAL_PROOF_MIN_SIGNUPS = 10;
const SOCIAL_PROOF_MIN_REPLIES = 500;
// Two clocks, mirroring the web module: signups are a cheap count over a few
// hundred rows and stay live; replies are a filtered count over `messages`, the
// biggest table in the system, and don't need second-level accuracy.
const SOCIAL_PROOF_SIGNUPS_TTL_MS = 15 * 1000;
const SOCIAL_PROOF_REPLIES_TTL_MS = 10 * 60 * 1000;
let _signupsCache = null;
let _repliesCache = null;

async function getSocialProof() {
  const now = Date.now();

  if (!_signupsCache || now - _signupsCache.at >= SOCIAL_PROOF_SIGNUPS_TTL_MS) {
    try {
      const { count } = await supabase.from('businesses').select('id', { count: 'exact', head: true });
      _signupsCache = { at: now, value: Number(count) || 0 };
    } catch (e) {
      console.warn('businesses.getSocialProof signups error:', e.message);
    }
  }

  if (!_repliesCache || now - _repliesCache.at >= SOCIAL_PROOF_REPLIES_TTL_MS) {
    try {
      const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true })
        .eq('is_ai_generated', true).eq('direction', 'outbound');
      _repliesCache = { at: now, value: Number(count) || 0 };
    } catch (e) {
      console.warn('businesses.getSocialProof replies error:', e.message);
      _repliesCache = _repliesCache || { at: now, value: 0 };
    }
  }

  const signups = _signupsCache?.value ?? 0;
  if (signups < SOCIAL_PROOF_MIN_SIGNUPS) return null;
  const replies = _repliesCache?.value ?? 0;
  return { signups, replies: replies >= SOCIAL_PROOF_MIN_REPLIES ? replies : null };
}

/** One Markdown line of proof, or '' when we have nothing honest to show. */
async function socialProofLine() {
  const p = await getSocialProof();
  if (!p) return '';
  const replies = p.replies
    ? ` — MiniMe has written *${p.replies.toLocaleString('en-US')}* replies for them`
    : '';
  const noun = p.signups === 1 ? 'business has' : 'businesses have';
  return `👥 *${p.signups.toLocaleString('en-US')}* ${noun} signed up to MiniMe${replies}.\n\n`;
}

module.exports = {
  getSocialProof,
  socialProofLine,
  findByOwnerTelegramId, findByGroupChatId, findByWebhookSecret, findByBotId,
  findById, findAll,
  create, update, setPanicMode, setTrustLevel, incrementOnboardingStep,
};
