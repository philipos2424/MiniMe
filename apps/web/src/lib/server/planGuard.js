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

import { planStatus } from '../plan.js';

export const planStatusServer = planStatus;

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
