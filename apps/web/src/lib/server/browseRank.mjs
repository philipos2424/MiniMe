/**
 * Ordering for the B2B Browse directory.
 *
 * Browse used to run its own `ilike` OR and return rows in whatever order
 * Postgres handed back, deduped through a Map — while MiniMe Search, one file
 * over, ranked the same table with keyword + semantic + product + quality
 * signals. This module stops the divergence: scoring comes from
 * searchRanker.mjs, and only the parts that are genuinely B2B-specific live
 * here.
 *
 * What is B2B-specific:
 *  - Liveness. A consumer searching for a café can be sent to a shop that has
 *    been quiet for a year; the shop still exists. An owner sending a business
 *    introduction to a dead account gets silence, and the first unanswered
 *    "Connect" teaches them the tab does not work. Dormancy therefore moves
 *    results down — but never removes them, because a quiet shop is still a
 *    real business the owner may have good reason to reach.
 *  - Proximity. The searcher is a known business with a location of its own,
 *    which anonymous consumer search never has.
 *
 * Both are bonuses on top of the relevance score rather than filters or sort
 * keys ahead of it, so a shop that genuinely does the thing always outranks a
 * fresh, nearby shop that does not.
 */
import { rankCandidates, isRelevant, singularize } from './searchRanker.mjs';

/** Active within this many days reads as "here right now". */
export const ACTIVE_DAYS = 7;
/** Beyond this, treat the shop as dormant for ranking purposes. */
export const RECENT_DAYS = 30;

// Deliberately smaller than a keyword hit (0.38 × field weight). Being open
// for business breaks ties; it does not make an unrelated shop a match.
const ACTIVE_BONUS = 0.12;
const RECENT_BONUS = 0.06;
const NEAR_BONUS = 0.08;

/**
 * Query → keywords, tokenized exactly like findBusinessIdsByProductMatch so a
 * shop matched on its products and a shop matched on its profile are scored
 * against the same words.
 */
export function browseKeywords(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(w => singularize(w.replace(/[^\p{L}\p{N}]/gu, '')))
    .filter(w => w.length > 2);
}

/**
 * 'week' | 'month' | null — null means "we have no activity on record",
 * which is not the same as "dormant" and must not be shown as if it were.
 */
export function activityLabel(row, now = Date.now()) {
  const ts = row?.last_active_date ? Date.parse(row.last_active_date) : NaN;
  if (!Number.isFinite(ts)) return null;
  const days = (now - ts) / 86400000;
  if (days <= ACTIVE_DAYS) return 'week';
  if (days <= RECENT_DAYS) return 'month';
  return null;
}

/**
 * The one hard exclusion: a business that never finished onboarding has no
 * bot a message could arrive at. Everything else stays in the directory and
 * competes on rank.
 */
export function isBrowsable(row) {
  return row?.onboarding_completed !== false;
}

function sameArea(a, b) {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Rank the directory.
 *
 * @param {object[]} rows        candidate business rows
 * @param {object}   opts
 * @param {string[]} opts.keywords  from browseKeywords(); empty = default view
 * @param {string}   [opts.category]
 * @param {string}   [opts.near]    the searching owner's own location
 * @param {number}   [opts.now]
 * @returns {object[]} ranked rows, each annotated with _activity and _browseScore
 */
export function orderBrowseResults(rows, { keywords = [], category = null, near = null, now = Date.now() } = {}) {
  const eligible = (rows || []).filter(isBrowsable);
  const ranked = rankCandidates(eligible, { keywords, category });

  // With a query, a shop that matches nothing is noise — the owner asked for
  // printers. With no query the tab is a directory, and every score is 0 by
  // construction, so filtering on relevance would empty it: the exact dead end
  // Browse shipped with.
  const kept = keywords.length ? ranked.filter(isRelevant) : ranked;

  for (const row of kept) {
    const activity = activityLabel(row, now);
    row._activity = activity;
    row._near = sameArea(row.location, near);
    row._browseScore = (row._score || 0)
      + (activity === 'week' ? ACTIVE_BONUS : activity === 'month' ? RECENT_BONUS : 0)
      + (row._near ? NEAR_BONUS : 0);
  }

  // Stable: rankCandidates already ordered by relevance, so equal-bonus rows
  // keep that order rather than shuffling between requests.
  return kept
    .map((row, i) => [row, i])
    .sort((a, b) => (b[0]._browseScore - a[0]._browseScore) || (a[1] - b[1]))
    .map(([row]) => row);
}
