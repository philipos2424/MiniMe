/**
 * Durable conversational-signup session store for the @MiniMeAgentBot webhook.
 *
 * Why this exists: the in-Telegram signup spans 3-4 separate webhook
 * invocations (type name → tap category → tap mode → paste token). The state
 * used to live in a module-level `Map`, but webhook routes run as serverless
 * functions — a later step can land on a cold/different instance where the Map
 * is empty, so the owner taps a button and gets dead silence mid-signup.
 *
 * State is keyed by the owner's Telegram user id and persisted in the
 * `signup_sessions` table (see migrations/021_signup_sessions.sql) so it
 * survives across invocations.
 *
 * Graceful fallback: if the table hasn't been created yet, every call silently
 * degrades to the old in-memory Map — behaviour is then no worse than before,
 * and flips to fully durable the moment the migration is applied. Sessions
 * older than TTL_MS are treated as expired so a stale half-signup never sticks.
 */
import { supabase } from './db';

const TTL_MS = 60 * 60 * 1000; // 1h — signup is normally <2 min; this is a safety sweep
const _mem = new Map();        // userId → { step, data, at }
let _tableMissing = false;     // latched once we learn the table doesn't exist

function isMissingTable(error) {
  if (!error) return false;
  // PGRST205: table not in PostgREST schema cache; 42P01: undefined_table
  return error.code === 'PGRST205' || error.code === '42P01' ||
    /relation .* does not exist|could not find the table/i.test(error.message || '');
}

export async function getSignupSession(userId) {
  const uid = String(userId);
  if (!_tableMissing) {
    try {
      const { data, error } = await supabase()
        .from('signup_sessions')
        .select('step, data, updated_at')
        .eq('user_id', uid)
        .maybeSingle();
      if (error) {
        if (isMissingTable(error)) _tableMissing = true;
        else throw error;
      } else if (data) {
        if (Date.now() - new Date(data.updated_at).getTime() > TTL_MS) {
          await deleteSignupSession(uid);
          return null;
        }
        return { step: data.step, data: data.data || {} };
      } else {
        return null; // table exists, no row → genuinely no session
      }
    } catch (e) {
      console.warn('[signupSession] get fell back to memory:', e.message);
    }
  }
  const m = _mem.get(uid);
  if (m && Date.now() - m.at > TTL_MS) { _mem.delete(uid); return null; }
  return m ? { step: m.step, data: m.data } : null;
}

export async function setSignupSession(userId, session) {
  const uid = String(userId);
  const step = session?.step;
  const data = session?.data || {};
  if (!_tableMissing) {
    try {
      const { error } = await supabase()
        .from('signup_sessions')
        .upsert({ user_id: uid, step, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) {
        if (isMissingTable(error)) _tableMissing = true;
        else throw error;
      } else {
        _mem.set(uid, { step, data, at: Date.now() }); // mirror for warm-instance speed
        return;
      }
    } catch (e) {
      console.warn('[signupSession] set fell back to memory:', e.message);
    }
  }
  _mem.set(uid, { step, data, at: Date.now() });
}

export async function deleteSignupSession(userId) {
  const uid = String(userId);
  _mem.delete(uid);
  if (_tableMissing) return;
  try {
    const { error } = await supabase().from('signup_sessions').delete().eq('user_id', uid);
    if (error && isMissingTable(error)) _tableMissing = true;
  } catch (e) {
    console.warn('[signupSession] delete failed (non-fatal):', e.message);
  }
}
