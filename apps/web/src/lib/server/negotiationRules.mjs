/**
 * negotiationRules — deterministic accept/counter/decline, no LLM.
 *
 * WHY THIS EXISTS
 * Harvested from apps/bot's `negotiation_engine.js` (`evaluateIncomingOffer`)
 * before that orphaned module was deleted — it encoded exactly the ordering
 * `docs/superpowers/plans/2026-08-02-supplier-negotiation-engine.md` calls
 * for: "deterministic core first; the LLM only words the message." The live
 * web path never got this. `runNegotiationResponse` (b2b.js) asks the model
 * to decide accept/counter/decline AND invent the number, with the owner's
 * limits handed over as unstructured text ("use your best judgment to get a
 * fair deal" when nothing is set) — the one place in the codebase where a
 * number the owner cares about is entirely the model's call.
 *
 * This function is the hard rule, checked BEFORE any model call: when the
 * owner has set a real limit and the offer clearly resolves against it,
 * decide by arithmetic. Only when no limit is set, or the amount can't be
 * read at all, does anything defer to the model — and even then the model
 * is judging fit and wording, never overriding a limit the owner actually set.
 */

/**
 * @param {{ amount: number|string, limits: object, direction: 'buy'|'sell' }} params
 *   direction 'sell': this business is being paid `amount` — check against
 *     limits.min_sell_price (a floor).
 *   direction 'buy': this business is paying `amount` — check against
 *     limits.max_budget_buy (a ceiling).
 * @returns {{action:'accept'|'counter'|'decline', reason:string, counterAmount?:number}|null}
 *   null means "no deterministic answer" — defer to the model, never guess.
 */
export function evaluateOfferDeterministic({ amount, limits, direction }) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null; // unparseable amount — nothing to decide by arithmetic

  if (direction === 'sell') {
    const floor = Number(limits?.min_sell_price);
    if (!Number.isFinite(floor)) return null; // no floor set — defer
    if (n >= floor) return { action: 'accept', reason: `${n} meets your minimum of ${floor}.` };
    return { action: 'counter', counterAmount: floor, reason: `${n} is below your minimum of ${floor}.` };
  }

  if (direction === 'buy') {
    const ceiling = Number(limits?.max_budget_buy);
    if (!Number.isFinite(ceiling)) return null; // no ceiling set — defer
    if (n <= ceiling) return { action: 'accept', reason: `${n} is within your budget of ${ceiling}.` };
    return { action: 'decline', reason: `${n} exceeds your budget of ${ceiling}.` };
  }

  return null;
}
