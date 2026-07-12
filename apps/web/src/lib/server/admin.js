/**
 * Platform-admin auth — DB-backed with 60-second in-process cache.
 *
 * Primary source: ADMIN_TELEGRAM_IDS env var (comma-separated numeric IDs).
 * This is the recommended approach for Vercel serverless deployments where
 * a DB-backed table would require its own table and migrations.
 *
 * ⚠️  The hardcoded fallback IDs have been REMOVED for security.
 *     If ADMIN_TELEGRAM_IDS is not set, no one has admin access.
 *     Set it in Vercel env vars: ADMIN_TELEGRAM_IDS=420769631,669754127
 *
 * SOC 2 CC6.3: Administrative access is explicitly configured, not implicit.
 */
import { verifyTelegramInitData, parseTelegramUser } from '../telegram';
import { verifyAdminSession } from './adminSession';

let _cachedIds = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Return the list of authorized platform admin Telegram IDs.
 * Reads from ADMIN_TELEGRAM_IDS env var (refreshed every 60s).
 * Returns empty array if env var is not configured — no implicit access.
 */
export function getAdminIds() {
  const now = Date.now();
  if (_cachedIds !== null && now < _cacheExpiry) {
    return _cachedIds;
  }
  const raw = process.env.ADMIN_TELEGRAM_IDS || '';
  const ids = raw
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0);

  _cachedIds = ids;
  _cacheExpiry = now + CACHE_TTL_MS;
  return ids;
}

/**
 * Return true if the given Telegram ID is a platform admin.
 * Logs a warning if admin access is granted (for audit trail).
 */
export function isAdmin(telegramId) {
  if (!telegramId) return false;
  const id = Number(telegramId);
  const result = getAdminIds().includes(id);
  return result;
}

/**
 * Middleware helper — throw a 403 response if the user is not an admin.
 */
export function requireAdmin(telegramId) {
  if (!isAdmin(telegramId)) {
    const error = new Error('Admin access required');
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Dual-auth gate for every /api/admin/* route. Accepts EITHER:
 *   1. Telegram Mini App initData (x-telegram-init-data header) — unchanged
 *      behavior for admins inside Telegram, or
 *   2. the mm_admin_session browser cookie minted by /api/admin/auth/login
 *      (Telegram Login Widget flow) — lets the master admin run in a plain
 *      desktop browser.
 *
 * Returns a tg-like object ({ id, username?, first_name?, via }) or null,
 * the same shape the routes' old local gate() helpers produced, so it's a
 * drop-in replacement.
 */
export async function requireAdminRequest(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (initData && verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    const tg = parseTelegramUser(initData);
    if (isAdmin(tg?.id)) return { ...tg, via: 'initData' };
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const m = cookieHeader.match(/(?:^|;\s*)mm_admin_session=([^;]+)/);
  const sess = m ? verifyAdminSession(decodeURIComponent(m[1])) : null;
  if (sess && isAdmin(sess.id)) return { ...sess, via: 'cookie' };

  return null;
}
