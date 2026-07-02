/**
 * Business queries used by API routes — inlined here so Vercel traces them
 * inside the Next app root.
 */
import { supabase } from './db';

export async function findByOwnerTelegramId(telegramId) {
  const { data, error } = await supabase()
    .from('businesses')
    .select('*')
    .eq('owner_telegram_id', telegramId)
    .single();
  if (error) return null;
  return data;
}

/** Lookup by owner OR sub-admin Telegram ID. Use for most MiniMe app routes. */
export async function findBusinessForUser(telegramId) {
  if (!telegramId) return null;
  const id = Number(telegramId);
  // Try owner first (most common path)
  const { data: owned } = await supabase()
    .from('businesses')
    .select('*')
    .eq('owner_telegram_id', id)
    .maybeSingle();
  if (owned) return owned;
  // Fall back to sub-admin membership
  const { data: subAdmin } = await supabase()
    .from('businesses')
    .select('*')
    .filter('sub_admin_telegram_ids', 'cs', `{${id}}`)
    .maybeSingle();
  return subAdmin || null;
}

export async function findByWebhookSecret(secret) {
  if (!secret) return null;
  const { data, error } = await supabase()
    .from('businesses')
    .select('*')
    .eq('webhook_secret', secret)
    .maybeSingle();
  if (error) return null;
  return data;
}

/** Find business by Telegram Business API connection ID */
export async function findByBizConnId(connId) {
  if (!connId) return null;
  const { data } = await supabase()
    .from('businesses')
    .select('*')
    .eq('telegram_biz_conn_id', connId)
    .maybeSingle();
  return data || null;
}

export async function findById(id) {
  const { data, error } = await supabase().from('businesses').select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

/** Find the business monitoring a given Telegram channel (channel_post routing
 *  on the shared platform bot, where the webhook secret doesn't identify the tenant). */
export async function findBySourceChannelId(channelId) {
  if (channelId === null || channelId === undefined || channelId === '') return null;
  const { data } = await supabase()
    .from('businesses')
    .select('*')
    .eq('source_channel_id', String(channelId))
    .maybeSingle();
  return data || null;
}

/** Find business by shop_code (deep-link routing for shared-mode bots) */
export async function findByShopCode(code) {
  if (!code) return null;
  const { data } = await supabase()
    .from('businesses')
    .select('*')
    .eq('shop_code', code)
    .maybeSingle();
  return data || null;
}

/**
 * Find the most recently messaged business for a customer Telegram ID — used by
 * the SHARED @MiniMeAgentBot to route a follow-up message from someone who isn't
 * an owner and isn't mid-signup.
 *
 * CRITICAL identity-isolation rule: one Telegram user can be a customer of
 * several businesses at once (and also an owner). This fallback runs on the
 * shared bot ONLY, so it must return a business that is actually reachable
 * THERE — a shared-mode storefront (has a shop_code, runs no custom bot of its
 * own). Returning a custom-bot tenant (e.g. iConnect on @Alfred…) or a
 * secretary-only business made the shared bot answer AS that business, leaking
 * its private knowledge base to a person who never opened it — the "knowledge
 * got confused" bug. Those customers reach their business via its own custom bot
 * or the owner's personal line, never via @MiniMeAgentBot.
 *
 * So we scan recent relationships newest-first and return the first one that is
 * genuinely shared-bot-reachable; skip the rest.
 */
export async function findLastBusinessForCustomer(telegramId) {
  if (!telegramId) return null;
  const { data: rows } = await supabase()
    .from('customers')
    .select('business_id, last_active_at')
    .eq('telegram_id', telegramId)
    .order('last_active_at', { ascending: false })
    .limit(10);
  if (!rows?.length) return null;

  for (const row of rows) {
    if (!row.business_id) continue;
    const biz = await findById(row.business_id);
    // Shared-bot-reachable only: shared storefront (shop_code set), and NOT a
    // custom-bot tenant (telegram_bot_username null). This keeps each business's
    // brain isolated to the channel its customers actually use.
    if (biz && biz.shop_code && !biz.telegram_bot_username) return biz;
  }
  return null;
}

/** Generate a unique 8-char shop code */
export function generateShopCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars (0,o,1,l,i)
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Columns that may not exist in older Supabase deployments — strip them on PGRST204.
// Keeps signup working until the migration is run.
const OPTIONAL_COLUMNS = ['owner_instructions', 'currency', 'meta', 'phone', 'language', 'trial_started_at', 'owner_username', 'consent_at', 'consent_version'];

function stripOptional(data) {
  const clean = { ...data };
  for (const c of OPTIONAL_COLUMNS) delete clean[c];
  return clean;
}

export async function create(businessData) {
  let { data, error } = await supabase().from('businesses').insert(businessData).select().single();
  // Retry without optional columns if schema cache rejects unknown column
  if (error?.code === 'PGRST204') {
    console.warn('[businesses.create] missing column — retrying without optional fields:', error.message);
    ({ data, error } = await supabase().from('businesses').insert(stripOptional(businessData)).select().single());
  }
  if (error) { console.error('businesses.create error:', error); return null; }
  return data;
}

export async function update(id, updates) {
  let { data, error } = await supabase().from('businesses').update(updates).eq('id', id).select().single();
  if (error?.code === 'PGRST204') {
    console.warn('[businesses.update] missing column — retrying without optional fields:', error.message);
    ({ data, error } = await supabase().from('businesses').update(stripOptional(updates)).eq('id', id).select().single());
  }
  if (error) { console.error('businesses.update error:', error); return null; }
  return data;
}
