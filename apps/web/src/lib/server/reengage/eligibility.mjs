/**
 * Should this person get a nudge right now, and which one?
 *
 * Two independent brakes, because either alone fails: a per-person schedule
 * (day 1 / 3 / 10, then permanent stop) and a hard cap of 3 sends. Nagging a
 * stalled signup costs more trust than the signup is worth.
 *
 * Pure — no I/O, clock injected — so it is unit-testable by direct import.
 */

export const MAX_SENDS = 3;
export const SEND_SCHEDULE_DAYS = [1, 3, 10];
export const MIN_AGE_MS = 24 * 3600_000; // day 1 — never ping someone mid-signup

const DAY_MS = 86400000;

/**
 * @returns {{ send: boolean, reason: string, sendIndex: number|null, isFinal: boolean }}
 */
export function decideSend({ stage, sends = [], stalledAt, optedOut = false, isAdminUser = false, now = Date.now() }) {
  const no = (reason) => ({ send: false, reason, sendIndex: null, isFinal: false });

  if (!stage) return no('no_stage');
  if (optedOut) return no('opted_out');
  if (isAdminUser) return no('suppressed_admin');

  const sentCount = sends.length;
  if (sentCount >= MAX_SENDS) return no('max_sends');

  const stalledMs = stalledAt ? new Date(stalledAt).getTime() : NaN;
  if (!Number.isFinite(stalledMs)) return no('unknown_stall_time');

  const age = now - stalledMs;
  if (age < MIN_AGE_MS) return no('too_new');

  // Send n is due once its scheduled day has passed since the stall.
  const dueAfter = SEND_SCHEDULE_DAYS[sentCount] * DAY_MS;
  if (age < dueAfter) return no('not_due');

  return {
    send: true,
    reason: 'due',
    sendIndex: sentCount,
    isFinal: sentCount === MAX_SENDS - 1,
  };
}

/**
 * Deterministic A/B split. Keyed on the person alone (not the stage) so their
 * arm never flips between sends — otherwise attribution measures nothing.
 */
export function pickVariant(telegramId /* , stage */) {
  const n = Number(telegramId) || 0;
  return n % 2 === 0 ? 'demand' : 'payoff';
}
