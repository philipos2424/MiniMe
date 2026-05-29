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
 * Find the most recently messaged business for a customer Telegram ID.
 * Used for routing follow-up messages in shared-bot mode (@MiniMeAgentBot).
 */
export async function findLastBusinessForCustomer(telegramId) {
  if (!telegramId) return null;
  const { data } = await supabase()
    .from('customers')
    .select('business_id, last_active_at')
    .eq('telegram_id', telegramId)
    .order('last_active_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.business_id) return null;
  return findById(data.business_id);
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
const OPTIONAL_COLUMNS = ['owner_instructions', 'currency', 'meta', 'phone', 'language'];

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
