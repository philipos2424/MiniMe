/**
 * Server-side plan enforcement for Pro-only API routes.
 *
 * The client gates (components/ui/UpgradeSheet.jsx + lib/plan.js) stop an owner
 * from *reaching* Advisor/Broadcast in the UI, but the routes themselves were
 * open — a stale client or a direct request bypassed the paywall entirely.
 * This is the authoritative check.
 *
 * Delegates to the client's planStatus() rather than mirroring it. This used to
 * be a hand-kept copy, and copies drift: on the swap branch, plan.js closed the
 * NULL-expiry door while this file kept it open, so the UI showed Free while
 * auto-send, the secretary cap and every Pro route still treated those
 * accounts as paid. One implementation can't disagree with itself.
 */
import { planStatus } from '../plan.js';

export function planStatusServer(business) {
  return planStatus(business);
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
