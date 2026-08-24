/**
 * Where a payment has got to — NOT whether the shop has access.
 *
 * These two questions used to share businesses.subscription_status, so
 * recording that a payment had arrived overwrote whether the merchant was on
 * trial. Paying us made a shop's access worse, and three separate commits went
 * into compensating for that rather than separating the two.
 *
 * subscription_status now answers only "does this shop get Pro"
 * (trial/active/expired/cancelled). This answers only "what is happening with
 * their money". Nothing here may ever be read to decide entitlement.
 */
export const PAYMENT_LIFECYCLE_STATES = [
  'awaiting_proof',  // asked how to pay, nothing uploaded yet
  'in_review',       // proof uploaded, a human must decide
  'verifying',       // verify.et is checking, no human needed yet
  'rejected',        // decided against; the shop keeps whatever access it had
];

export const PAYMENT_LIFECYCLE_LABELS = {
  awaiting_proof: { label: 'Awaiting proof', hint: 'Asked how to pay, nothing uploaded yet' },
  in_review:      { label: 'In review',      hint: 'Proof uploaded, waiting on an admin decision' },
  verifying:      { label: 'Verifying',      hint: 'verify.et is checking with the bank' },
  rejected:       { label: 'Rejected',       hint: 'Could not be confirmed' },
};

/** Is a human or a pending check standing between this payment and a decision? */
export function isAwaitingDecision(business) {
  const s = business?.payment_state;
  return s === 'in_review' || s === 'verifying';
}
