/**
 * Every tunable number for MiniMe Swap, in one place.
 *
 * These are product decisions, not implementation details — MAX_SWAP_CARDS in
 * particular is a commercial guardrail (businesses pay, swaps do not), so it
 * lives somewhere a reviewer can find it rather than inline in a query.
 */
export const MAX_PHOTOS = 3;
export const MAX_TEXT = 120;
export const MAX_SWAP_CARDS = 3;
export const EXPIRY_DAYS = 21;
export const COMPLETION_DELAY_DAYS = 3;
export const REVEALS_PER_DAY = 10;
export const REPORTS_TO_HIDE = 3;
export const DRAFT_TTL_MINUTES = 60;

export const CONDITIONS = ['like_new', 'good', 'worn', 'parts'];

export const CONDITION_LABELS = {
  like_new: { en: 'Like new', am: 'እንደ አዲስ' },
  good:     { en: 'Good',     am: 'ጥሩ' },
  worn:     { en: 'Worn',     am: 'ያገለገለ' },
  parts:    { en: 'For parts', am: 'ለመለዋወጫ' },
};
