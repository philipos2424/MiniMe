/**
 * "Sell on MiniMe" recruiting funnel rollup: tapped → signed up → activated.
 *
 * Pure so it can be unit-tested. Attribution rules:
 *  - tapped: distinct telegram ids with a sell_cta_tapped event in the window.
 *  - signedUp: distinct OWNERS (not business rows — one owner with two shops
 *    counts once) whose business was created AT OR AFTER their earliest tap.
 *    Owners who already had a business and tapped out of curiosity don't count.
 *  - activated: the signed-up owners whose business completed onboarding.
 *
 * Ids are compared as strings — onboarding_events.telegram_id and
 * businesses.owner_telegram_id are both bigint today, but inserts have used
 * Number() and String() in different places, so normalize both sides.
 */

export function computeSellFunnel(taps, businesses) {
  // Earliest tap per telegram id.
  const firstTapAt = new Map();
  for (const t of taps || []) {
    if (t?.telegram_id == null) continue;
    const id = String(t.telegram_id);
    const at = t.created_at || '';
    const prev = firstTapAt.get(id);
    if (prev === undefined || at < prev) firstTapAt.set(id, at);
  }

  const signedUpOwners = new Set();
  const activatedOwners = new Set();
  for (const b of businesses || []) {
    if (b?.owner_telegram_id == null) continue;
    const id = String(b.owner_telegram_id);
    const tapAt = firstTapAt.get(id);
    if (tapAt === undefined) continue;
    // Attribute only businesses created after the tap; a missing created_at
    // (pre-migration rows) is treated as pre-existing, i.e. not attributed.
    if (!b.created_at || b.created_at < tapAt) continue;
    signedUpOwners.add(id);
    if (b.onboarding_completed) activatedOwners.add(id);
  }

  return {
    tapped: firstTapAt.size,
    signedUp: signedUpOwners.size,
    activated: activatedOwners.size,
  };
}

/** Split an array into chunks of `size` (for PostgREST .in() URL limits). */
export function chunk(arr, size = 200) {
  const out = [];
  for (let i = 0; i < (arr?.length || 0); i += size) out.push(arr.slice(i, i + size));
  return out;
}
