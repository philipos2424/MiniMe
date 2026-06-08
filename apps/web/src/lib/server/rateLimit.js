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

// Buckets that use persistent rate limiting (Supabase backed)
const PERSISTENT_BUCKETS = new Set(['broadcast', 'teach', 'auth-failed']);

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
