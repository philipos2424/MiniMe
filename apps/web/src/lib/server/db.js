/**
 * Service-role Supabase client for API routes.
 * Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (NOT the anon key).
 */
import { createClient } from '@supabase/supabase-js';

let _client = null;
export function supabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}
