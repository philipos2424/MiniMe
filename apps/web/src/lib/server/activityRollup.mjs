/**
 * Which shops moved since we last looked?
 *
 * Migration 051 split two things that had been sharing one column.
 * last_active_date is the OWNER's streak, written only by
 * gamification.updateStreak() when an owner messages their own shop bot — 21
 * shops have ever linked one, so it was NULL for 732 shops that had been
 * exchanging messages for weeks. b2bAudience.activityTier() and
 * browseRank.activityLabel() both read it as liveness anyway, which is why
 * b2bAudience's header reports "686 of 887 businesses have never been active":
 * that figure is the column, not the market.
 *
 * last_shop_activity_date now carries shop liveness, and cron/activity-rollup
 * keeps it current from message traffic. This module is the decision the cron
 * makes — pure, so it can be tested without a database.
 */

// Ethiopia is UTC+3, no DST. Matches gamification.todayInAddis().
const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * The calendar day a timestamp fell on in Addis, as 'YYYY-MM-DD'.
 * Returns null for anything unparseable, so a bad row can never be stamped.
 *
 * The offset matters at the bucket edges: a message at 01:00 local is the
 * previous day in UTC, and activityTier() cuts at 30 and 90 days — a shop
 * stamped a day stale can fall out of an outreach segment it belongs in.
 */
export function addisDay(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + ADDIS_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Diff message traffic against what each shop already has stored.
 *
 * @param {Array<{business_id: string, created_at: string}>} messages
 *   Recent message rows, in any order.
 * @param {Record<string, string|null>} storedByBusinessId
 *   Current last_shop_activity_date per business ('YYYY-MM-DD' or null).
 * @returns {Array<{id: string, last_shop_activity_date: string}>}
 *   Only the shops whose stored day is genuinely behind, in the order they
 *   first appear in `messages`.
 */
export function pendingActivityUpdates(messages, storedByBusinessId = {}) {
  const latest = new Map(); // insertion-ordered, so output order is stable

  for (const m of messages || []) {
    const id = m?.business_id;
    if (!id) continue;
    const day = addisDay(m?.created_at);
    if (!day) continue;
    const seen = latest.get(id);
    // Dates are 'YYYY-MM-DD', so a string compare is a date compare.
    if (!seen || day > seen) latest.set(id, day);
  }

  const updates = [];
  for (const [id, day] of latest) {
    const stored = storedByBusinessId?.[id];
    // Never walk a shop's liveness backwards. A late-arriving or backdated
    // message must not un-age a shop that has been active since — that would
    // drop a live shop into 'dormant' and into a win-back campaign it has no
    // business receiving.
    if (stored && String(stored) >= day) continue;
    updates.push({ id, last_shop_activity_date: day });
  }
  return updates;
}
