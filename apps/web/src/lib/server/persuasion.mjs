/**
 * persuasion — Cialdini influence cues for MiniMe Search result cards.
 *
 * Applies Robert Cialdini's principles of persuasion to nudge a searcher toward
 * contacting a business. HARD RULE: every cue is derived from REAL data. No
 * fabricated review counts, no invented "2 left in stock", no fake urgency.
 * Deceptive social proof would harm real users and the marketplace's trust, so
 * a cue only appears when the underlying fact is true.
 *
 * Principles used:
 *   Authority     — verified status; being the top-rated shop in the result set.
 *   Social proof  — real review count + rating; real search demand this window.
 *   Scarcity      — genuinely being the sole/among-few matches for the query.
 *   Liking/Reciprocity — warm, zero-friction CTA copy (see ctaLabel).
 *
 * Pure and dependency-free → unit-tested.
 */

const MIN_REVIEWS_FOR_PROOF = 3;   // below this, a rating average isn't trustworthy social proof
const STRONG_RATING = 4.5;
const MIN_VOLUME_FOR_POPULAR = 20; // don't cry "popular" in a low-traffic category

/**
 * Compute page-level context once per result set, so per-card cues can make
 * claims that are true RELATIVE to what the searcher is actually seeing
 * (e.g. "top-rated" means top-rated among these results).
 */
export function persuasionContext(results, { categoryLabel = null } = {}) {
  const list = results || [];
  const rated = list
    .filter(b => (b.total_reviews || 0) >= MIN_REVIEWS_FOR_PROOF)
    .sort((a, b) => (Number(b.average_rating) || 0) - (Number(a.average_rating) || 0));
  const topRatedId = rated.length ? rated[0].id : null;

  const maxSearch = list.reduce((m, b) => Math.max(m, b.search_count || 0), 0);
  // Only treat volume as "popular" when there's genuine traffic to speak of.
  const popularThreshold = maxSearch >= MIN_VOLUME_FOR_POPULAR ? Math.ceil(maxSearch * 0.6) : Infinity;

  return { topRatedId, popularThreshold, categoryLabel, total: list.length };
}

/**
 * Ordered persuasion cues for one business, strongest first, capped.
 * @returns {{principle: string, text: string}[]}
 */
export function persuasionCues(business, ctx = {}, { max = 2 } = {}) {
  const cues = [];
  const reviews = business.total_reviews || 0;
  const rating = Number(business.average_rating) || 0;

  // Authority — verified identity.
  if (business.verified) cues.push({ principle: 'authority', text: '✅ Verified' });

  // Authority — the best-reviewed option the searcher is looking at.
  if (ctx.topRatedId && business.id === ctx.topRatedId && reviews >= MIN_REVIEWS_FOR_PROOF) {
    cues.push({ principle: 'authority', text: `🏆 Top-rated${ctx.categoryLabel ? ` ${ctx.categoryLabel}` : ''}` });
  }

  // Social proof — real ratings from real customers.
  if (reviews >= MIN_REVIEWS_FOR_PROOF && rating >= STRONG_RATING) {
    cues.push({ principle: 'social_proof', text: `⭐ ${rating}/5 from ${reviews} customers` });
  }

  // Social proof — real, current search demand.
  if (Number.isFinite(ctx.popularThreshold) && (business.search_count || 0) >= ctx.popularThreshold) {
    cues.push({ principle: 'social_proof', text: '🔥 In demand right now' });
  }

  // Scarcity — genuinely the only / one of very few matches for this query.
  if (ctx.total === 1) {
    cues.push({ principle: 'scarcity', text: '💎 The only match for your search' });
  } else if (ctx.total > 1 && ctx.total <= 3) {
    cues.push({ principle: 'scarcity', text: `Only ${ctx.total} shops match — you're seeing them all` });
  }

  return cues.slice(0, max);
}

/** One-line persuasion strip for a card, or '' if nothing truthful to say. */
export function persuasionLine(business, ctx = {}, opts = {}) {
  const cues = persuasionCues(business, ctx, opts);
  return cues.map(c => c.text).join(' · ');
}

/**
 * Liking/reciprocity: a warm, zero-friction call to action. Kept truthful —
 * contacting the bot really is free and needs no signup.
 */
export function ctaLabel(business) {
  const name = business?.name || 'this shop';
  return `💬 Chat with ${name} — free`;
}
