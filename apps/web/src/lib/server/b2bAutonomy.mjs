/**
 * b2bAutonomy — the owner's dial for how much the B2B agent may do without
 * asking, per business.
 *
 * WHY THIS EXISTS
 * `maybeAutoNegotiate` (b2b.js) used to be gated on a single boolean
 * (`b2b_auto_negotiate`) that never consulted the business's trust level —
 * a SHADOW-level owner could still have deals closed autonomously. And
 * `recordDeal` fired the instant the model said `action: 'accept'`, with no
 * human anywhere in the path.
 *
 * Rather than hardcoding one strictness, the owner picks one of three
 * explicit levels, stored in `businesses.notification_prefs.b2b_autonomy`:
 *
 *   review_all   (default) — every outbound fan-out needs a tap; negotiation
 *                replies are drafted for the owner to send; closing a deal
 *                needs a tap.
 *   review_deals — outreach sends automatically, the agent negotiates, but
 *                closing a deal still needs a tap.
 *   full_auto    — outreach and negotiation run unattended; a deal
 *                auto-closes ONLY inside the price floor/ceiling the owner
 *                explicitly set in notification_prefs.b2b_limits.
 *
 * The dial changes WHO taps. It never changes whether the money limits
 * apply — full_auto still can't close outside b2b_limits, and none of the
 * three levels can skip them. Below TRUSTED (see plan.js effectiveTrustLevel)
 * every level behaves like review_all regardless of what the owner picked —
 * the dial is a ceiling the trust ladder can lower, never a way around it.
 */
import { effectiveTrustLevel } from '../plan.js';

export const B2B_AUTONOMY_LEVELS = ['review_all', 'review_deals', 'full_auto'];
export const DEFAULT_B2B_AUTONOMY = 'review_all';

const TRUSTED = 2; // mirrors TRUST_LEVELS.TRUSTED in constants.js

/** Read the owner's chosen level, defaulting to the safest one. */
export function getB2BAutonomy(business) {
  const raw = business?.notification_prefs?.b2b_autonomy;
  return B2B_AUTONOMY_LEVELS.includes(raw) ? raw : DEFAULT_B2B_AUTONOMY;
}

/**
 * True when outbound research/B2B messages may be sent without a per-batch
 * approval tap. Requires both the owner's level AND a trust level of
 * TRUSTED or above — a low-trust business stays review_all no matter what
 * the stored preference says.
 */
export function canAutoSendOutreach(business) {
  if (effectiveTrustLevel(business) < TRUSTED) return false;
  return getB2BAutonomy(business) !== 'review_all';
}

/**
 * True when the agent may negotiate (send counters/questions) without a
 * per-message approval tap. Same level+trust gate as outreach — negotiating
 * on someone's behalf is at least as consequential as sending the opener.
 */
export function canAutoNegotiate(business) {
  if (effectiveTrustLevel(business) < TRUSTED) return false;
  return getB2BAutonomy(business) !== 'review_all';
}

/**
 * True when a deal may be closed (recordDeal) without a human tap.
 * Requires full_auto AND the offer to sit within the owner's own limits —
 * this is the one check that is never satisfied by the level alone.
 *
 * @param {object} business
 * @param {{ total?: number, price_per_unit?: number, currency?: string }} offer
 * @param {'buy'|'sell'} direction - is this business paying (buy) or being paid (sell)?
 */
export function canAutoCloseDeal(business, offer, direction) {
  if (effectiveTrustLevel(business) < TRUSTED) return false;
  if (getB2BAutonomy(business) !== 'full_auto') return false;

  const limits = business?.notification_prefs?.b2b_limits || {};
  const amount = Number(offer?.total ?? offer?.price_per_unit);
  if (!Number.isFinite(amount)) return false; // no verifiable number → never auto-close

  if (direction === 'buy') {
    const ceiling = Number(limits.max_budget_buy);
    return Number.isFinite(ceiling) && amount <= ceiling;
  }
  if (direction === 'sell') {
    const floor = Number(limits.min_sell_price);
    return Number.isFinite(floor) && amount >= floor;
  }
  return false; // unknown direction → never auto-close
}

/**
 * Human-readable description of what a level lets the agent do without
 * asking — for the /b2b settings panel, so the choice is never a guess.
 */
export function describeB2BAutonomy(level) {
  switch (level) {
    case 'full_auto':
      return 'Outreach sends automatically, MiniMe negotiates, and deals close automatically — but only within the price limits you set below.';
    case 'review_deals':
      return 'Outreach sends automatically and MiniMe negotiates for you, but every deal needs your approval before it closes.';
    case 'review_all':
    default:
      return "You approve every outreach batch before it sends, and every negotiation reply before it's sent. Nothing happens without your tap.";
  }
}
