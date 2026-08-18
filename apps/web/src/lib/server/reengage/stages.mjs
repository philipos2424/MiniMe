/**
 * Where in the signup funnel did this person stall?
 *
 * The answer comes from onboarding_events (migration 026), which records one
 * whitelisted step per wizard screen keyed by telegram_id. A person's stage is
 * the FURTHEST rung they reached, so event order and duplicates never matter.
 *
 * Pure — no I/O — so it is unit-testable by direct import. Kept as .mjs
 * because src/lib/server/*.js uses extensionless specifiers that only the Next
 * bundler resolves and node --test cannot.
 */

export const STAGES = ['A1', 'B1', 'B2', 'B3', 'B4', 'B5'];

const TOUCHED_APP = ['sell_cta_tapped', 'app_open', 'welcome', 'tour_started', 'tour_finished', 'tour_skipped'];
const CHAT_DONE   = ['customer_chat_finished', 'customer_chat_skipped'];
const CONNECTED   = ['connected_custom', 'connected_shared'];

/**
 * @param {{ steps: string[], business: object|null }} input
 * @returns {string|null} stage id, or null if this person is not a stalled candidate
 */
export function detectStage({ steps, business }) {
  const seen = new Set(steps || []);
  const has = (...names) => names.some(n => seen.has(n));

  // Already live — nothing to re-engage.
  if (has(...CONNECTED)) return null;
  if (business?.onboarding_completed || business?.telegram_bot_username) return null;

  // Furthest rung first.
  if (seen.has('connect_custom')) return 'B5';
  if (seen.has('tryit_replied')) return 'B4';
  if (has(...CHAT_DONE)) return 'B3';
  if (seen.has('shop_name_saved')) return 'B2';

  // The businesses row is created at the "Let's go" tap with a placeholder
  // name, so a row alone means "account, unnamed" — not "named their shop".
  if (business) return 'B1';

  if (has(...TOUCHED_APP)) return 'A1';

  return null;
}
