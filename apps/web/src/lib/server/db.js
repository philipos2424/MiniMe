/**
 * Service-role Supabase client for API routes.
 * Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (NOT the anon key).
 */
import { createClient } from '@supabase/supabase-js';

// Next.js patches global fetch; Vercel's Data Cache will happily serve stale
// PostgREST GET responses (keyed by URL) forever — even across deployments.
// EVERY server-side Supabase client must opt out with cache:'no-store'.
// Use this for any createClient call outside this file.
export const noStoreFetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

let _client = null;
export function supabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  _client = createClient(url, key, {
    auth: { persistSession: false },
    // CRITICAL: Next.js patches global fetch and Vercel's Data Cache caches
    // GET requests — supabase-js reads with a constant query URL (e.g. the
    // cron jobs' businesses scans) were served stale snapshots indefinitely,
    // even across deployments. Symptom: a cron re-read rows it had just
    // written and got the pre-write version back, double-sending nudges.
    // no-store opts every PostgREST call out of the framework cache.
    global: { fetch: noStoreFetch },
  });
  return _client;
}
