import { PRO_PERIODS } from './plan.js';

/** Calendar-month subscription periods in UTC, clamped to the target month. */
export function extendSubscription(expiresAt, months, now = Date.now()) {
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new Error('Invalid subscription period');
  const existing = Date.parse(expiresAt);
  const base = new Date(Number.isFinite(existing) && existing > now ? existing : now);
  const day = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + months);
  const endOfMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, endOfMonth));
  return base.toISOString();
}

/** Same eligibility and paid-period rules for dashboard and Telegram review. */
export function paymentReviewUpdate(business, action, selectedPeriod, now = Date.now()) {
  if (!['approve', 'reject'].includes(action)) throw new Error('Invalid review action');
  const provisional = business.subscription_status === 'active' && business.payment_verified !== true
    && !!business.payment_proof_url && String(business.payment_notes || '').startsWith('Auto-activated');
  if (business.subscription_status !== 'pending_review' && !provisional) throw new Error('This payment has already been reviewed or is not awaiting review');
  if (!business.payment_ref) throw new Error('Payment reference is missing');

  if (action === 'reject') {
    const paidAccess = !provisional && (Date.parse(business.subscription_expires_at) > now
      || (business.plan_tier === 'pro' && !business.subscription_expires_at));
    const trialAccess = Date.parse(business.trial_ends_at) > now;
    return { period: null, updates: {
      subscription_status: paidAccess ? 'active' : trialAccess ? 'trial' : 'cancelled',
      ...(!paidAccess ? { plan_tier: 'free', subscription_plan: 'free' } : {}),
      ...(provisional ? { subscription_expires_at: null } : {}),
      payment_verified: false,
      payment_notes: `Rejected by admin — ${business.payment_ref} — ${new Date(now).toISOString()}`,
    } };
  }

  const recordedPeriod = PRO_PERIODS[business.verifyet_plan] || (provisional ? PRO_PERIODS.pro_monthly : null);
  if (recordedPeriod && selectedPeriod && selectedPeriod !== recordedPeriod.key) throw new Error('The selected period differs from the recorded period');
  const period = recordedPeriod || PRO_PERIODS[selectedPeriod];
  if (!period) throw new Error('Choose the paid period after checking the payment evidence');
  if (provisional && !Number.isFinite(Date.parse(business.subscription_expires_at))) throw new Error('Current paid expiry is missing. Check the subscription before approving.');
  return { period, updates: {
    subscription_status: 'active', plan_tier: 'pro', subscription_plan: 'pro', payment_verified: true,
    // Monthly trust-based activation already granted its time; review merely
    // verifies the claim and must not sell the same month twice.
    subscription_expires_at: provisional ? business.subscription_expires_at : extendSubscription(business.subscription_expires_at, period.months, now),
    verifyet_plan: period.key,
    payment_notes: `${period.label} approved by admin — ${business.payment_ref} — ${new Date(now).toISOString()}`,
  } };
}
