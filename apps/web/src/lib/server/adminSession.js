/**
 * Browser sessions for the master admin — lets /admin work in a plain
 * desktop browser, outside the Telegram Mini App.
 *
 * Flow: /admin/login renders the official Telegram Login Widget → the widget
 * posts { id, first_name, username?, photo_url?, auth_date, hash } to
 * /api/admin/auth/login → verifyLoginWidget() checks Telegram's HMAC →
 * isAdmin(id) checks the ADMIN_TELEGRAM_IDS allowlist → mintAdminSession()
 * issues an HttpOnly cookie the admin API routes accept as an alternative
 * to Mini App initData (see requireAdminRequest in ./admin.js).
 *
 * No JWT library on purpose — the payload is base64url JSON + HMAC-SHA256
 * with ADMIN_SESSION_SECRET, verified with timingSafeEqual. If the secret
 * env var is unset, every session is invalid: no silent default key.
 */
import crypto from 'crypto';

export const COOKIE_NAME = 'mm_admin_session';
const SESSION_TTL_S = 7 * 24 * 3600; // 7 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/** Issue a signed session token for a verified admin Telegram user. */
export function mintAdminSession(user) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET not set');
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    id: Number(user.id),
    username: user.username || null,
    first_name: user.first_name || null,
    iat: now,
    exp: now + SESSION_TTL_S,
  }));
  return `${payload}.${sign(payload, secret)}`;
}

/** Verify a session token; returns the payload or null. */
export function verifyAdminSession(token) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || !token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadB64, secret);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload?.id || !payload?.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

/**
 * Verify a Telegram Login Widget payload.
 *
 * NOTE this is the LOGIN WIDGET spec, which differs from Mini App initData
 * (lib/telegram.js): the data-check-string is every field except `hash`
 * sorted alphabetically as `k=v` joined by '\n', and the HMAC key is the
 * plain SHA256 of the bot token (initData keys with HMAC('WebAppData')).
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyLoginWidget(data, botToken, maxAgeSeconds = 600) {
  if (!data?.hash || !data?.id || !data?.auth_date || !botToken) return false;

  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate)) return false;
  if (Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds) return false;

  const checkString = Object.keys(data)
    .filter(k => k !== 'hash' && data[k] !== undefined && data[k] !== null)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('\n');

  const key = crypto.createHash('sha256').update(botToken).digest();
  const expected = crypto.createHmac('sha256', key).update(checkString).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(data.hash), 'hex'));
  } catch { return false; }
}
