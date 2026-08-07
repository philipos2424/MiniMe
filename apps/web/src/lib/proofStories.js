/**
 * Customer results shown on the paywall (client-safe).
 *
 * HOW THIS DIFFERS FROM socialProof.js — read before adding anything here.
 *
 * The counts in socialProof.js are computed live, because they're aggregate
 * facts we can query. The entries below cannot be: they're testimony about a
 * specific customer, and they come from whoever adds them. So the guardrail is
 * provenance, not a database query:
 *
 *   • Every entry must be something that ACTUALLY HAPPENED to a real shop, and
 *     that you could show evidence for if a customer or a regulator asked.
 *     Never write an illustrative or "representative" figure here. One invented
 *     result and none of the real numbers on this screen are evidence either.
 *   • Get the shop's permission before their result goes in — even unnamed. It
 *     is their revenue, not ours.
 *   • Record `source` so the claim is traceable to whoever verified it. An
 *     entry nobody can trace is an entry to delete.
 *   • A single strong result is NOT a typical result. `oneShop: true` makes the
 *     UI say so plainly. Presenting a best case as what a new customer should
 *     expect is deceptive regardless of the number being true.
 *
 * If you can't satisfy all four, ship no story. The live counts already carry
 * the page.
 */

export const PROOF_STORIES = [
  {
    id: 'orders-while-away-16k',
    // The result, in the owner's own terms.
    amountEtb: 16000,
    headline: 'One shop earned 16,000 ETB from orders MiniMe handled while they were away.',
    detail: 'Customers messaged after hours. MiniMe answered, quoted, and took the orders. The owner saw them the next morning.',
    // This is one shop's result, not an average — the UI must say so.
    oneShop: true,
    // Which paywall this belongs on. Auto-send is exactly what earned it.
    feature: 'auto_send',
    // Traceability. Replace with the shop (with their consent) once you have it
    // — a name and a neighbourhood roughly doubles how much this is believed.
    source: 'Reported by the shop owner to the MiniMe team.',
  },
];

/**
 * The best story for a given paywall, or null.
 * Feature-specific first, then any general one.
 */
export function storyForFeature(feature) {
  if (!PROOF_STORIES.length) return null;
  return PROOF_STORIES.find(s => s.feature === feature)
      || PROOF_STORIES.find(s => !s.feature)
      || null;
}
