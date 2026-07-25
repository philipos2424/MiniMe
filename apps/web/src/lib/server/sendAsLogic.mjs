/**
 * Pure decision logic for channel selection (owner's personal Telegram vs the
 * bot) — no I/O, so it can be unit-tested in isolation. sendAs.js imports these.
 */

// How long a proven-failed chat stays ineligible for personal-identity sends
// before we're willing to try again (Telegram permissions can change).
export const FAILURE_COOLDOWN_MS = 24 * 3600000;

/**
 * Decide whether a personal-identity (owner's own account) send should even be
 * attempted for this chat. Does NOT guarantee success — Telegram is the final
 * arbiter — this only decides whether it's worth trying before falling back.
 *
 * @param {object} opts
 * @param {'auto'|'bot'|'personal'} [opts.prefer] - explicit preference; 'bot' always
 *   short-circuits to false.
 * @param {string|null} [opts.bizConnId] - business.telegram_biz_conn_id
 * @param {object|null} [opts.coverage] - the biz_conn_chats row for this chat, or null
 * @param {number} [opts.nowMs]
 * @returns {boolean}
 */
export function shouldTryPersonal({ prefer, bizConnId, coverage, nowMs = Date.now() }) {
  if (prefer === 'bot') return false;
  if (!bizConnId) return false;
  if (!coverage) return false; // never proven reachable — don't gamble a cold send
  if (coverage.send_failed_at) {
    const failedMs = Date.parse(coverage.send_failed_at);
    if (Number.isFinite(failedMs) && nowMs - failedMs < FAILURE_COOLDOWN_MS) return false;
  }
  return true;
}

/**
 * Which token a send should use. Business connections belong to the SHARED
 * agent bot (@MiniMeAgentBot) — only that bot's webhook ever handles
 * business_connection / business_message updates — so a personal-identity send
 * MUST use the shared token even when the tenant has their own bot. A
 * bot-identity send prefers the tenant's own token when they have one.
 *
 * This is a pure decision function; sendAs.js supplies the actual token strings.
 *
 * @param {'owner'|'bot'} as
 * @param {{ tenantToken: string|null, sharedToken: string|null }} tokens
 * @returns {string|null}
 */
export function pickToken(as, { tenantToken, sharedToken }) {
  if (as === 'owner') return sharedToken || null;
  return tenantToken || sharedToken || null;
}
