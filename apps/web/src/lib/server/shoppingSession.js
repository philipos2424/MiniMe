/**
 * Sticky "shopping context" for the shared @MiniMeAgentBot.
 *
 * Problem this solves: the shared bot is ONE chat per Telegram user, and the
 * webhook routes a sender to their OWN business first (owner short-circuit). So
 * a person who *owns* a business literally cannot hold a conversation as a
 * *customer* of a DIFFERENT shared business — every follow-up message bounces
 * back to their own dashboard. (This is why an owner clicking a peer's
 * `?start=shop_XXX` link "couldn't talk to their bot".)
 *
 * When an owner explicitly opens another business's shop link, we remember
 * "this user is currently shopping at business X" here, and the webhook lets
 * plain-text follow-ups keep flowing to X. ANY slash-command (e.g. /start,
 * /orders) clears the context and returns them to their own dashboard — so an
 * owner can NEVER get locked out of their own account. Sessions also expire on
 * a short TTL as a safety sweep.
 *
 * Same durability story as signupSession.js: persisted in `shopping_sessions`
 * (survives serverless cold starts), degrades to an in-memory Map if the table
 * is missing.
 */
import { supabase } from './db';

const TTL_MS = 30 * 60 * 1000; // 30 min — a browsing session, not a lease
const _mem = new Map();         // userId → { businessId, at }
let _tableMissing = false;

function isMissingTable(error) {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' ||
    /relation .* does not exist|could not find the table/i.test(error.message || '');
}

/** Returns the businessId the user is currently shopping at, or null. */
export async function getShoppingContext(userId) {
  const uid = String(userId);
  if (!_tableMissing) {
    try {
      const { data, error } = await supabase()
        .from('shopping_sessions')
        .select('business_id, updated_at')
        .eq('user_id', uid)
        .maybeSingle();
      if (error) {
        if (isMissingTable(error)) _tableMissing = true;
        else throw error;
      } else if (data) {
        if (Date.now() - new Date(data.updated_at).getTime() > TTL_MS) {
          await clearShoppingContext(uid);
          return null;
        }
        return data.business_id;
      } else {
        return null;
      }
    } catch (e) {
      console.warn('[shoppingSession] get fell back to memory:', e.message);
    }
  }
  const m = _mem.get(uid);
  if (m && Date.now() - m.at > TTL_MS) { _mem.delete(uid); return null; }
  return m ? m.businessId : null;
}

export async function setShoppingContext(userId, businessId) {
  const uid = String(userId);
  if (!_tableMissing) {
    try {
      const { error } = await supabase()
        .from('shopping_sessions')
        .upsert({ user_id: uid, business_id: businessId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) {
        if (isMissingTable(error)) _tableMissing = true;
        else throw error;
      } else {
        _mem.set(uid, { businessId, at: Date.now() });
        return;
      }
    } catch (e) {
      console.warn('[shoppingSession] set fell back to memory:', e.message);
    }
  }
  _mem.set(uid, { businessId, at: Date.now() });
}

export async function clearShoppingContext(userId) {
  const uid = String(userId);
  _mem.delete(uid);
  if (_tableMissing) return;
  try {
    const { error } = await supabase().from('shopping_sessions').delete().eq('user_id', uid);
    if (error && isMissingTable(error)) _tableMissing = true;
  } catch (e) {
    console.warn('[shoppingSession] clear failed (non-fatal):', e.message);
  }
}
