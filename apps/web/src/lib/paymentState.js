/**
 * Why is this shop Pro? (client-safe, pure)
 *
 * planStatus() answers "does this shop get Pro features". That is an
 * entitlement question and it is deliberately generous — trials count, and a
 * plan_tier of 'pro' is honoured unconditionally so nobody loses access to a
 * feature because of a billing edge case.
 *
 * This answers a DIFFERENT question: has anyone actually paid us? Those two
 * were conflated, and the result is 660 shops carrying plan_tier='pro' with no
 * payment reference between them — indistinguishable, in the data, from real
 * customers. You cannot track revenue, chase renewals, or size the business
 * while "is Pro" and "has paid" are the same field.
 *
 * States, most to least certain:
 *   paid      — a verified payment is on record
 *   claimed   — proof uploaded and auto-activated, not yet spot-checked
 *   granted   — Pro access with NO payment record at all (comped, legacy,
 *               or set by an older signup path). Revenue-relevant: these are
 *               the accounts to reconcile.
 *   trial     — inside the free month
 *   free      — no Pro access
 *   expired   — had access, lapsed
 */

export const PAYMENT_STATES = ['paid', 'claimed', 'granted', 'interested', 'trial', 'free', 'expired'];

export const PAYMENT_STATE_LABELS = {
  paid:       { label: 'Paid',             tone: 'good',    hint: 'Verified payment on record' },
  claimed:    { label: 'Claimed',          tone: 'warn',    hint: 'Proof uploaded, awaiting verification' },
  granted:    { label: 'Granted (unpaid)', tone: 'danger',  hint: 'Pro access with no payment record' },
  interested: { label: 'Wanted to pay',    tone: 'neutral', hint: 'Asked for payment details but never completed — worth a follow-up' },
  trial:      { label: 'Trial',            tone: 'neutral', hint: 'Inside the free month' },
  free:       { label: 'Free',             tone: 'muted',   hint: 'No Pro access' },
  expired:    { label: 'Expired',          tone: 'muted',   hint: 'Had access, lapsed' },
};

/**
 * @param {object} business  businesses row
 * @param {number} [paymentCount]  completed inbound payments for this business,
 *   if the caller has it. Without it we fall back to the row's own fields.
 */
export function paymentState(business, paymentCount = null) {
  if (!business) return 'free';

  const tier   = business.plan_tier || business.subscription_plan || 'free';
  const status = business.subscription_status || 'trial';
  const now    = Date.now();
  const trialEnds = business.trial_ends_at ? new Date(business.trial_ends_at).getTime() : 0;
  const expiresAt = business.subscription_expires_at ? new Date(business.subscription_expires_at).getTime() : 0;

  const onTrial   = status === 'trial' && trialEnds > now;
  const hasProAccess = tier === 'pro'
    || (status === 'active' && (!expiresAt || expiresAt > now))
    || onTrial;

  if (onTrial && tier !== 'pro') return 'trial';

  if (hasProAccess) {
    // payment_ref is written the moment a merchant ASKS for payment details
    // (api/payment/subscribe), long before any money moves — using it as
    // "has paid" counted mere interest as revenue. Evidence of an actual
    // attempt is a verified payment, a completed payments row, or an uploaded
    // proof; wanting to pay is not one of them.
    const hasPayment = paymentCount != null
      ? paymentCount > 0
      : (business.payment_verified === true || !!business.payment_proof_url);
    if (!hasPayment) return 'granted';
    return business.payment_verified ? 'paid' : 'claimed';
  }

  if (status === 'expired' || status === 'cancelled') return 'expired';

  // No Pro access, but they went and asked how to pay — the most qualified
  // lead the platform has, and previously invisible.
  if (business.payment_ref) return 'interested';

  return 'free';
}

/** Money actually collected — 'granted' contributes nothing. */
export function isRevenueBearing(state) {
  return state === 'paid' || state === 'claimed';
}
