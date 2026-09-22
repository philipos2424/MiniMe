/**
 * Hybrid rate limiter — in-memory for speed with Supabase fallback for persistence.
 *
 * Strategy:
 *   1. In-memory Map is checked first (fast, 0ms overhead)
 *   2. For CRITICAL buckets (broadcast, teach), Supabase is also checked
 *      so cold-start resets don't bypass important limits
 *   3. Regular per-request limits (webhook) stay in-memory only
 *
 * On Vercel serverless: in-memory resets per cold-start, but provides
 * within-invocation protection. Critical limits survive via Supabase.
 */
import { supabase } from './db';

// In-memory store: key → { count, resetAt }
const store = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.resetAt < now) store.delete(k);
  }
}, 5 * 60 * 1000);

// Buckets that use persistent rate limiting (Supabase backed). B2B outbound/
// inbound caps (5/pair/day, 50/day flood) were in-memory only — on Vercel
// serverless every cold start reset them to zero, so the caps were
// effectively per-lambda-instance, not global. These buckets get their writes
// mirrored to Supabase, but rateLimit() below still decides `ok` from the
// in-memory count — a cold start still starts a fresh window here.
//
// For limits where that bypass actually matters (login brute force, payment
// spam), use rateLimitPersistent() instead: it reads AND increments an
// authoritative count in Postgres, so no cold start or extra instance resets
// the window. This in-memory path remains for hot, high-volume buckets (the
// Telegram webhook) where a DB round trip per call is too expensive.
const PERSISTENT_BUCKETS = new Set(['broadcast', 'teach', 'auth-failed', 'b2b-outbound', 'b2b-inbound']);

/**
 * Check and increment rate limit.
 * @returns {{ ok: boolean, count: number, retryAfter?: number }}
 */
export function rateLimit(identifier, bucket, maxRequests = 60, windowSecs = 60) {
  const key = `${bucket}:${identifier}`;
  const now = Date.now();
  const windowMs = windowSecs * 1000;

  // In-memory check (always fast)
  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }
  entry.count++;
  const ok = entry.count <= maxRequests;

  // For critical buckets, async-update Supabase (fire-and-forget)
  // This ensures the limit persists across cold starts for important operations
  if (PERSISTENT_BUCKETS.has(bucket)) {
    persistRateLimit(key, entry.count, entry.resetAt, maxRequests).catch(() => {});
  }

  return {
    ok,
    count: entry.count,
    retryAfter: ok ? undefined : Math.ceil((entry.resetAt - now) / 1000),
  };
}

/**
 * Authoritative, cross-instance rate limit.
 *
 * Unlike rateLimit() above — which decides `ok` from an in-process Map that
 * every serverless cold start wipes — this asks Postgres to atomically
 * check-and-increment (see migration 046_rate_limit_atomic.sql). The count is
 * shared across every lambda, so a burst sprayed across fresh instances still
 * trips the cap. Use this for security-sensitive limits (login brute force,
 * payment-proof spam) where per-instance counting is a real bypass.
 *
 * Costs one DB round trip per call, so it is NOT for hot paths like the
 * Telegram webhook (120/min/IP) — those stay on the in-memory rateLimit().
 *
 * Fail-open: if the DB is unreachable we fall back to the in-memory limiter
 * rather than locking every user out. That preserves within-instance
 * protection but means a DB outage weakens the global cap — an acceptable
 * tradeoff here, matching this module's "never block on limiter failure" rule.
 *
 * The result always carries `persistent: true|false` so a caller for whom the
 * cap is the ONLY brake (e.g. swap-reveal, guarding against bulk contact
 * harvesting) can tell "really checked against Postgres" apart from "fell
 * back to the near-unlimited in-memory count" and choose to fail closed
 * instead. Existing callers that only read `ok` are unaffected.
 *
 * @returns {Promise<{ ok: boolean, count: number, retryAfter?: number, persistent: boolean }>}
 */
export async function rateLimitPersistent(identifier, bucket, maxRequests = 60, windowSecs = 60) {
  const key = `${bucket}:${identifier}`;
  try {
    const sb = supabase();
    const { data, error } = await sb.rpc('increment_rate_limit', {
      p_key: key,
      p_max: maxRequests,
      p_window_secs: windowSecs,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      return { ...rateLimit(identifier, bucket, maxRequests, windowSecs), persistent: false };
    }
    const resetMs = new Date(row.reset_at).getTime();
    return {
      ok: !!row.allowed,
      count: row.count,
      retryAfter: row.allowed ? undefined : Math.max(1, Math.ceil((resetMs - Date.now()) / 1000)),
      persistent: true,
    };
  } catch {
    return { ...rateLimit(identifier, bucket, maxRequests, windowSecs), persistent: false };
  }
}

/**
 * Async-persist rate limit to Supabase for critical buckets.
 * Uses upsert with a TTL so old records don't pile up.
 */
async function persistRateLimit(key, count, resetAt, maxRequests) {
  try {
    const sb = supabase();
    await sb.from('rate_limits').upsert({
      key,
      count,
      reset_at: new Date(resetAt).toISOString(),
      max_requests: maxRequests,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  } catch {
    // Never block on rate limit persistence failure
  }
}

/**
 * Check persistent rate limit from Supabase (for cold-start resistance).
 * Used by broadcast route to check if a recent broadcast was sent.
 * Returns true if rate limited (should be blocked).
 */
export async function checkPersistentLimit(identifier, bucket, maxRequests = 1, windowSecs = 300) {
  const key = `${bucket}:${identifier}`;
  try {
    const sb = supabase();
    const { data } = await sb.from('rate_limits')
      .select('count, reset_at, max_requests')
      .eq('key', key)
      .gt('reset_at', new Date().toISOString())
      .maybeSingle();

    if (!data) return false; // No record = not rate limited
    return data.count >= (data.max_requests || maxRequests);
  } catch {
    return false; // Fail open — never block if DB check fails
  }
}

/**
 * Get IP from Next.js request headers.
 * Works behind Nginx/Cloudflare (uses X-Forwarded-For).
 */
export function getIP(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}
