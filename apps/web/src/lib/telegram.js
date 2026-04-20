import crypto from 'crypto';

export function verifyTelegramInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    return hash === expectedHash;
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
