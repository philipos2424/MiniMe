/**
 * Telegram Stars <-> ETB conversion.
 *
 * Stored as businesses.notification_prefs.payments.stars_per_etb. Merchants
 * think in "how many birr is one Star", so the settings page edits ETB per Star
 * and we store the inverse.
 *
 * One Star is worth ~$0.013 and 1 ETB is roughly $0.0078, so a fair rate is
 * ~0.6 Stars per ETB. A value of 3000 was found live (a 1,500 ETB order quoted
 * at 4.5M Stars), so anything outside the sane band falls back to the default
 * instead of being trusted.
 */
export const DEFAULT_STARS_PER_ETB = 0.6;
export const MIN_STARS_PER_ETB = 0.05;
export const MAX_STARS_PER_ETB = 5;

export function isValidStarsPerEtb(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= MIN_STARS_PER_ETB && n <= MAX_STARS_PER_ETB;
}

export function normalizeStarsPerEtb(v) {
  return isValidStarsPerEtb(v) ? Number(v) : DEFAULT_STARS_PER_ETB;
}

export function starsForEtb(totalEtb, starsPerEtb) {
  return Math.max(1, Math.round(Number(totalEtb) * normalizeStarsPerEtb(starsPerEtb)));
}

// For the settings field, which shows "1 Star = X ETB".
export function etbPerStar(starsPerEtb) {
  return Math.round((1 / normalizeStarsPerEtb(starsPerEtb)) * 100) / 100;
}
