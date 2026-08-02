/**
 * Deterministic accept/counter/walk_away/escalate gate for supplier negotiations.
 * NEVER calls an LLM — round/target/walk-away math only. The LLM is used
 * exclusively in draftCounter() to word a message; it never decides outcomes.
 */
function evaluateQuote(negotiation, quote) {
  const price = Number(quote.unit_price);
  if (price <= negotiation.target_price) return 'accept';
  if (price > negotiation.walk_away_price) return 'walk_away';
  if (negotiation.round >= negotiation.max_rounds) return 'escalate';
  return 'counter';
}

module.exports = { evaluateQuote };
