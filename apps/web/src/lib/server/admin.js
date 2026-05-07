/**
 * Platform-admin auth.
 * The allowlist lives in ADMIN_TELEGRAM_IDS env var (comma-separated numeric IDs).
 * Falls back to the bootstrap owner ID if unset (your account).
 */
export function getAdminIds() {
  const raw = process.env.ADMIN_TELEGRAM_IDS || '';
  const ids = raw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
  if (ids.length) return ids;
  // Fallback bootstrap IDs (owner accounts)
  return [420769631, 669754127];
}

export function isAdmin(telegramId) {
  if (!telegramId) return false;
  return getAdminIds().includes(Number(telegramId));
}
