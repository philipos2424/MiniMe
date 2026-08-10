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
  // Earliest tap per telegram id (also remember its meta for source
  // attribution — which surface produced this tap, and whether it was
  // traceable to a specific search).
  const firstTapAt = new Map();
  const firstTapMeta = new Map();
  for (const t of taps || []) {
    if (t?.telegram_id == null) continue;
    const id = String(t.telegram_id);
    const at = t.created_at || '';
    const prev = firstTapAt.get(id);
    if (prev === undefined || at < prev) {
      firstTapAt.set(id, at);
      firstTapMeta.set(id, t.meta || null);
    }
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

  // Source breakdown: which surface (search bot /start, /sell, Market, the
  // in-results nudge) produced each tap. Taps logged before this field
  // existed (or a legacy bare "sell" link) fall into 'unknown'. Every nudge
  // tap carries a distinct search_log_id in its source (nudge_<uuid>), so
  // those collapse into one 'nudge' bucket rather than one bucket per tap.
  const bySource = {};
  let searchAttributed = 0;
  for (const meta of firstTapMeta.values()) {
    const rawSource = meta?.source || 'unknown';
    const source = rawSource.startsWith('nudge_') ? 'nudge' : rawSource;
    bySource[source] = (bySource[source] || 0) + 1;
    if (meta?.search_log_id) searchAttributed += 1;
  }

  return {
    tapped: firstTapAt.size,
    signedUp: signedUpOwners.size,
    activated: activatedOwners.size,
    bySource,
    searchAttributed,
  };
}

/** Split an array into chunks of `size` (for PostgREST .in() URL limits). */
export function chunk(arr, size = 200) {
  const out = [];
  for (let i = 0; i < (arr?.length || 0); i += size) out.push(arr.slice(i, i + size));
  return out;
}
