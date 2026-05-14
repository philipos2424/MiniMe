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

export async function findById(id) {
  const { data, error } = await supabase().from('businesses').select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

export async function create(businessData) {
  const { data, error } = await supabase().from('businesses').insert(businessData).select().single();
  if (error) { console.error('businesses.create error:', error); return null; }
  return data;
}

export async function update(id, updates) {
  const { data, error } = await supabase().from('businesses').update(updates).eq('id', id).select().single();
  if (error) { console.error('businesses.update error:', error); return null; }
  return data;
}
