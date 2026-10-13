/**
 * Server-side plan enforcement for Pro-only API routes.
 *
 * The client gates (components/ui/UpgradeSheet.jsx + lib/plan.js) stop an owner
 * from *reaching* Advisor/Broadcast in the UI, but the routes themselves were
 * open — a stale client or a direct request bypassed the paywall entirely.
 * This is the authoritative check.
 *
 * Deliberately mirrors the client's planStatus() so the two can't drift into
 * disagreeing about who is Pro. Trial (unexpired) counts as Pro: the whole
 * point of the free month is full access.
 */

export function planStatusServer(business) {
  if (!business) return { isPro: false, onTrial: false, tier: 'free' };
  const tier   = business.plan_tier || business.subscription_plan || 'free';
  const status = business.subscription_status || 'trial';
  const now    = Date.now();
  const trialEnds = business.trial_ends_at ? new Date(business.trial_ends_at).getTime() : 0;
  const expiresAt = business.subscription_expires_at ? new Date(business.subscription_expires_at).getTime() : 0;

  // A payment waiting for review (pending_review) keeps the access the owner
  // already had — a trial or an unexpired subscription — until it's decided.
  // Without this, paying for 3 months mid-trial switched Pro off while waiting.
  const reviewing = status === 'pending_review';
  const activeSub = (status === 'active' && (!expiresAt || expiresAt > now)) || (reviewing && expiresAt > now);
  const onTrial   = (status === 'trial' || reviewing) && trialEnds > now;
  const isPro     = tier === 'pro' || activeSub || onTrial;

  return { isPro, onTrial, tier, status };
}

export function isProServer(business) {
  return planStatusServer(business).isPro;
}

/**
 * Standard 403 body for a Pro-gated route. The client maps `error:'pro_required'`
 * to opening the upgrade sheet, so keep the code stable.
 */
export const PRO_REQUIRED = {
  error: 'pro_required',
  message: 'This feature is part of MiniMe Pro.',
};
