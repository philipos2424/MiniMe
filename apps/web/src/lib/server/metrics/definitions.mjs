/**
 * Admin metric definitions — the ONLY place a metric is defined.
 *
 * Both the nightly rollup (cron/metrics-rollup) and later live "today"
 * queries import from here, so the same word can never mean two things on
 * two screens again (spec 2026-10-13 §3.1). Pure and dependency-free so it
 * runs under plain `node --test`.
 */
import { dayKeyEAT } from '../fetch-all.mjs';
import { planStatus } from '../../plan.js';
import { paymentState } from '../../paymentState.js';

export { dayKeyEAT, paymentState };

/** Nightly recompute window — late payments/approvals land on the right day. */
export const RECOMPUTE_DAYS = 3;
/** First-run backfill depth. Messages older than 18 months are archived anyway. */
export const MAX_BACKFILL_DAYS = 400;
/** No successful run within this many hours = stale dashboard, alert. */
export const STALE_AFTER_HOURS = 26;

/** Owner onboarding funnel, in order. Counts are distinct telegram ids per day. */
export const FUNNEL_STEPS = [
  'welcome', 'signup', 'shop_name', 'shop_name_saved',
  'customer_chat_started', 'customer_chat_finished',
  'connect', 'connected', 'trial_started',
];
const STEP_ALIASES = { connected_shared: 'connected', connected_custom: 'connected' };

export function funnelStep(step) {
  const s = STEP_ALIASES[step] || step;
  return FUNNEL_STEPS.includes(s) ? s : null;
}

/** Test/demo shops. Only an explicit true counts — null is a real shop. */
export function isInternal(business) {
  return business?.is_internal === true;
}

/** llm_call_log: raw:* rows are per-provider attempts, not chain outcomes. */
export function isChainCall(row) {
  return !String(row?.route || '').startsWith('raw:');
}

/** Entitlement bucket, straight from planStatus() — never re-derived. */
export function planState(business) {
  const p = planStatus(business);
  if (p.onTrial) return 'trial';
  if (p.isPro) return 'pro';
  if (p.expired) return 'expired';
  return 'free';
}

/** Upper-middle median, rounded to an integer; null for no data. */
export function median(nums) {
  const xs = (nums || []).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  return Math.round(xs[Math.floor(xs.length / 2)]);
}

/** Start of an EAT day as a UTC ISO string (EAT = UTC+3, no DST). */
export function eatMidnightIso(dayKey) {
  return new Date(`${dayKey}T00:00:00+03:00`).toISOString();
}

/** Today panel contracts: units and periods travel with the values. */
export const TODAY_METRICS = {
  signups: { unit: 'shops', period: 'Today so far (EAT)', comparison: 'Same weekday last week, full EAT day' },
  activity: { unit: 'shops', period: 'Last 24 hours', comparison: 'None' },
  ai: { unit: 'calls', period: 'Today so far (EAT)', comparison: 'None' },
  webhooks: { unit: 'deliveries', period: 'Last hour', comparison: 'None' },
  payments: { unit: 'shops', period: 'Current pending review queue', comparison: 'None' },
};

export function rollupFreshness(finishedAt, now = Date.now()) {
  const timestamp = finishedAt ? Date.parse(finishedAt) : NaN;
  const valid = Number.isFinite(timestamp) && timestamp <= now;
  const ageHours = valid ? (now - timestamp) / 3600000 : null;
  return {
    data_as_of: valid ? new Date(timestamp).toISOString() : null,
    age_hours: ageHours,
    stale: !valid || ageHours > STALE_AFTER_HOURS,
    threshold_hours: STALE_AFTER_HOURS,
  };
}

function externalIds(businesses) {
  return new Set(businesses.filter(b => !isInternal(b)).map(b => b.id));
}

export function countTodaySignups(businesses, now = Date.now()) {
  return businesses.filter(b => !isInternal(b) && dayKeyEAT(b.created_at) === dayKeyEAT(now) && Date.parse(b.created_at) <= now).length;
}

/** Caller supplies the requested time window; inbound customer activity only. */
export function liveShopCount(businesses, messages) {
  const ids = externalIds(businesses);
  return new Set(messages.filter(m => ids.has(m.business_id) && m.direction === 'inbound').map(m => m.business_id)).size;
}

export function aiOutcomes(businesses, rows) {
  const ids = externalIds(businesses);
  const calls = rows.filter(r => ids.has(r.business_id) && isChainCall(r) && r.route !== '__daily_summary__');
  const failed = calls.filter(r => r.ok === false).length;
  return { calls: calls.length, failed, failure_pct: calls.length ? Math.round(failed / calls.length * 1000) / 10 : null };
}

export function webhookOutcomes(businesses, rows) {
  const ids = externalIds(businesses);
  const deliveries = rows.filter(r => ids.has(r.business_id) && ['success', 'failure'].includes(r.delivery_status));
  const failed = deliveries.filter(r => r.delivery_status === 'failure');
  return { deliveries: deliveries.length, failed: failed.length, affected_shops: new Set(failed.map(r => r.business_id)).size };
}

/** main's existing review queue, not the separate payment lifecycle branch. */
export function pendingReviewCount(businesses) {
  return businesses.filter(b => !isInternal(b) && b.subscription_status === 'pending_review').length;
}
