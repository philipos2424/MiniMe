import crypto from 'crypto';

/**
 * Verify a Telegram Mini App initData string.
 *
 * Security checks applied:
 *  1. HMAC-SHA256 signature matches (per Telegram spec)
 *  2. auth_date is within the last 24 hours (prevents replay attacks)
 *
 * @param {string} initData  — the raw initData string from window.Telegram.WebApp.initData
 * @param {string} botToken  — the bot token used to create the HMAC key
 * @param {number} [maxAgeSeconds=86400] — max age of the token in seconds (default 24h)
 */
export function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    // 1. Signature check
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    // Constant-time comparison to prevent timing attacks
    const hashBuf     = Buffer.from(hash, 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (hashBuf.length !== expectedBuf.length) return false;
    if (!crypto.timingSafeEqual(hashBuf, expectedBuf)) return false;

    // 2. Freshness check — reject tokens older than maxAgeSeconds
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate) return false;
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > maxAgeSeconds) {
      console.warn(`[auth] Rejected stale initData — age: ${ageSeconds}s, max: ${maxAgeSeconds}s`);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function parseTelegramUser(initData) {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    return userStr ? JSON.parse(decodeURIComponent(userStr)) : null;
  } catch {
    return null;
  }
}

// Client-side helpers (browser only)
export function getTelegramWebApp() {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp || null;
}

export function isTelegramWebApp() {
  const twa = getTelegramWebApp();
  return !!(twa && twa.initData);
}

export function getTelegramTheme() {
  const twa = getTelegramWebApp();
  if (!twa) return null;
  return twa.colorScheme;
}

export function expandTelegramApp() {
  getTelegramWebApp()?.expand();
}

export function closeTelegramApp() {
  getTelegramWebApp()?.close();
}

export function setMainButton(text, onClick) {
  const twa = getTelegramWebApp();
  if (!twa) return;
  twa.MainButton.setText(text);
  twa.MainButton.onClick(onClick);
  twa.MainButton.show();
}

export function hideMainButton() {
  getTelegramWebApp()?.MainButton.hide();
}

export function showBackButton(onClick) {
  const twa = getTelegramWebApp();
  if (!twa) return;
  twa.BackButton.onClick(onClick);
  twa.BackButton.show();
}

export function hideBackButton() {
  getTelegramWebApp()?.BackButton.hide();
}

export function haptic(type = 'light') {
  getTelegramWebApp()?.HapticFeedback.impactOccurred(type);
}
