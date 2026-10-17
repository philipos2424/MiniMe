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
import { DAILY_SUMMARY_ROUTE } from '../llmCallLog.mjs';

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

/**
 * llm_call_log: raw:* rows are per-provider attempts, not chain outcomes, and
 * the llm-stats cron writes one DAILY_SUMMARY_ROUTE row per day holding that
 * day's totals — counting it would double every token and add a fake call.
 */
export function isChainCall(row) {
  const route = String(row?.route || '');
  return !route.startsWith('raw:') && route !== DAILY_SUMMARY_ROUTE;
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
