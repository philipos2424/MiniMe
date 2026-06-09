/**
 * Shared client-side helpers for the "link your own Telegram bot" flow.
 *
 * Used by BOTH entry points — first-run onboarding (app/(dashboard)/onboarding)
 * and the upgrade path (app/(dashboard)/settings/bot). Keeping them here stops
 * the two screens from drifting apart on token parsing / error wording.
 *
 * Pure functions, no server imports — safe in client components.
 */

// Telegram bot tokens look like `1234567890:AAH…` (numeric id, colon, 35-char
// secret). Mirror the server's accept rule in api/bot/link: /^\d+:[A-Za-z0-9_-]{30,}$/
const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{30,}$/;

/**
 * Pull a valid bot token out of whatever the owner pasted. They commonly copy
 * the whole BotFather line ("Use this token to access the HTTP API: 123:AA…")
 * or grab stray whitespace/newlines — extract the token substring if present,
 * otherwise just trim. Returns a string (possibly still invalid — caller checks).
 */
export function extractToken(raw) {
  if (!raw) return '';
  const m = String(raw).match(/\d{6,12}:[A-Za-z0-9_-]{30,}/);
  return (m ? m[0] : String(raw)).trim();
}

/** True if `raw` (after extraction) is a well-formed bot token. */
export function isValidBotToken(raw) {
  return TOKEN_RE.test(extractToken(raw));
}

// Map server error CODES → plain language an owner can act on. Without this the
// UI literally printed "invalid_token_format" / "set_webhook_failed" at people.
const LINK_ERRORS = {
  invalid_token_format: 'That doesn’t look like a full bot token. It should look like 1234567890:AAH… — copy the whole line BotFather sent you.',
  token_rejected_by_telegram: 'Telegram didn’t accept that token. If you tapped “Revoke” in BotFather, use the NEW token it gave you.',
  platform_token_not_allowed: 'That’s a MiniMe system token, not your own bot. Create one with @BotFather — or use “MiniMe directly” instead.',
  set_webhook_failed: 'Almost there — we couldn’t finish the connection. Tap Link once more. If it still fails, message support.',
  unauthorized: 'Your session expired. Fully close MiniMe (swipe it away), re-open it, and try again.',
  bad_init_data: 'Your session expired. Fully close MiniMe (swipe it away), re-open it, and try again.',
  could_not_create_business: 'Something went wrong on our side. Please try again in a moment.',
  internal: 'Something went wrong. Please try again in a moment.',
};

/** Turn a server error code into an owner-friendly sentence. */
export function friendlyLinkError(code, fallback) {
  return LINK_ERRORS[code] || fallback || 'Couldn’t connect. Check the token and try again.';
}
