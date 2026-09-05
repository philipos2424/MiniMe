/**
 * b2bAudience — who's actually worth contacting.
 *
 * WHY THIS EXISTS
 * `B2B_REACHABLE_FILTER` answers "can we technically deliver a Telegram
 * message to this business's owner" — every one of the 887 registered
 * businesses has a `shop_code`, so it excludes almost nobody. It says
 * nothing about whether anyone is actually there to read it.
 *
 * Measured on the live database: outreach sent to a business that has EVER
 * been active gets replies 8.0% of the time (7/88). Outreach sent to a
 * business that has NEVER been active (last_active_date IS NULL) gets
 * replies 1.6% of the time (1/63) — and 42% of every inquiry ever sent went
 * to exactly that never-active group. 686 of 887 registered businesses
 * (77%) have never been active at all.
 *
 * The agent was shouting into a graveyard, getting silence back, and then
 * inventing suppliers to fill the silence (see researchTruth.mjs). This
 * module is the other half of the fix: don't create the silence in the
 * first place.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The day this shop was last alive, by whichever signal we have.
 *
 * last_active_date is bumped only by gamification.updateStreak(), which runs
 * only when an OWNER messages their OWN shop bot — and 21 shops have ever
 * linked one. It was NULL for 732 shops that had demonstrably been exchanging
 * messages for weeks, which is the real source of the "686 of 887 have never
 * been active" figure in this module's header: not a dead platform, a column
 * almost nothing could write.
 *
 * Migration 051 split the two meanings. last_shop_activity_date is the shop's
 * traffic; last_active_date stays the owner's streak and is read only as a
 * fallback, for rows the backfill could not date.
 */
function lastAliveOn(business) {
  const shop = business?.last_shop_activity_date;
  const owner = business?.last_active_date;
  const dates = [shop, owner]
    .filter(Boolean)
    .map(d => new Date(d).getTime())
    .filter(t => !Number.isNaN(t));
  return dates.length ? new Date(Math.max(...dates)) : null;
}

/**
 * Classify one business's activity tier.
 * @param {object} business - row with last_shop_activity_date (or the legacy
 *   last_active_date) and onboarding_completed
 * @param {Date} [now]
 * @returns {'active'|'warm'|'dormant'|'never'}
 */
export function activityTier(business, now = new Date()) {
  const last = lastAliveOn(business);
  if (!last) return 'never';
  const days = (now.getTime() - last.getTime()) / DAY_MS;
  if (days <= 30 && business.onboarding_completed) return 'active';
  if (days <= 90) return 'warm';
  return 'dormant';
}

/**
 * Select up to `count` candidates for outreach, preferring `active`, falling
 * back to `warm` only when `active` can't fill the slots, and never reaching
 * into `dormant` or `never` automatically. Honest about a shortfall instead
 * of padding the list.
 *
 * @param {object[]} candidates
 * @param {{ count: number, now?: Date }} opts
 * @returns {{
 *   selected: object[],
 *   tiered: { active: object[], warm: object[], dormant: object[], never: object[] },
 *   shortfall: boolean,
 *   message: string|null,
 * }}
 */
export function selectByActivity(candidates, { count, now = new Date() } = {}) {
  const tiered = { active: [], warm: [], dormant: [], never: [] };
  for (const b of candidates || []) tiered[activityTier(b, now)].push(b);

  const selected = [...tiered.active];
  if (selected.length < count) {
    selected.push(...tiered.warm.slice(0, count - selected.length));
  }
  const finalSelection = selected.slice(0, count);
  const shortfall = finalSelection.length < Math.min(count, candidates?.length || 0)
    && finalSelection.length < count
    && (tiered.dormant.length > 0 || tiered.never.length > 0);

  return {
    selected: finalSelection,
    tiered,
    shortfall,
    message: shortfall
      ? `Only ${finalSelection.length} active or recently-active business${finalSelection.length === 1 ? '' : 'es'} match` +
        ` — ${tiered.dormant.length + tiered.never.length} more registered businesses match the category but haven't` +
        ` been active recently, so they were left out rather than padding the list.`
      : null,
  };
}
