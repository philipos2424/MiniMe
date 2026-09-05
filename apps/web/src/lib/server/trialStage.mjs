/**
 * When did a shop's access actually run out, and have we told them?
 *
 * Extracted from cron/outreach-rules so it can be tested directly — and
 * because the version that lived inline had a defect that cost us most of the
 * platform. It opened with
 *
 *     if (tier === 'pro' || subscription_status === 'active' || ...) return false;
 *
 * treating the STATUS STRING as proof of entitlement. bulk-activate-trials had
 * written exactly that status onto every comped shop, with a dated 30-day
 * window beside it. When 543 of those windows closed in the week of
 * 3 August 2026 the shops correctly lost Pro — planStatus() reads the date —
 * and just as correctly received nothing at all, because to this function they
 * still looked like subscribers. 658 shops sit on a closed window with
 * trial_warn_stage = NULL: never warned, never notified, never asked to pay.
 *
 * The rule here, and the reason the status string is now read as little as
 * possible: **an entitlement is judged by its dates.** Only two things are
 * exempt, and both match lib/plan.js exactly so the pair cannot drift into
 * disagreeing about who is entitled:
 *
 *   • plan_tier === 'pro' — the undated, deliberate grant. planStatus() honours
 *     it unconditionally, so we must never nudge it.
 *   • subscription_status === 'cancelled' — an explicit opt-out.
 *
 * Everything else carries a window, and a window is a fact.
 */
import { planStatus } from '../plan.js';

const DAY_MS = 86_400_000;

/**
 * The moment a shop's paid-equivalent access ends (epoch ms), or null when it
 * carries no dated window at all and therefore cannot be staged.
 *
 * Deliberately the LATER of the two dates. Every comped shop still carries the
 * trial_ends_at it had before the grant — reading that one first would date
 * each notice about two weeks early and word a lapsed comp as an expired
 * trial, which is not what happened to them.
 */
export function accessEndsAt(business) {
  const trial = business?.trial_ends_at ? new Date(business.trial_ends_at).getTime() : 0;
  const grant = business?.subscription_expires_at
    ? new Date(business.subscription_expires_at).getTime()
    : 0;
  const endsAt = Math.max(trial || 0, grant || 0);
  return Number.isFinite(endsAt) && endsAt > 0 ? endsAt : null;
}

/**
 * Does this business match a trial-stage outreach rule right now?
 *
 * `config` comes from an outreach_rules row: { phase, stage_value, and either
 * at_or_below_days (warn) or after_days (winback) }. businesses.trial_warn_stage
 * is the idempotency counter — it records the furthest stage already sent, and
 * stages descend (7 → 3 → 1 → 0 → -7 → -30), so one comparison sequences the
 * whole ladder without any status bookkeeping.
 */
export function evalTrialStage(business, config, now) {
  if (!business?.owner_private_chat_id) return false;

  const tier = business.plan_tier || business.subscription_plan;
  if (tier === 'pro' || business.subscription_status === 'cancelled') return false;

  const endsAt = accessEndsAt(business);
  if (!endsAt) return false;

  const sent = business.trial_warn_stage;
  const alreadyPast = sent !== null && sent !== undefined && config.stage_value >= sent;
  if (alreadyPast) return false;

  if (config.phase === 'warn') {
    const daysLeft = Math.ceil((endsAt - now) / DAY_MS);
    return daysLeft > 0 && daysLeft <= (config.at_or_below_days ?? 0);
  }
  if (config.phase === 'expired') {
    return endsAt <= now;
  }
  if (config.phase === 'winback') {
    const daysSince = Math.floor((now - endsAt) / DAY_MS);
    return daysSince >= (config.after_days ?? 0);
  }
  return false;
}

/**
 * Is this row's subscription_status lying?
 *
 * True only for a row that claims 'active' while planStatus() — the single
 * source of truth on entitlement — says it is not Pro. That is precisely the
 * 658-shop condition: status says subscriber, dates say Free, and every
 * dashboard, filter and segment believes the status.
 *
 * Reconciling them to 'expired' is not what restores the nudges (evalTrialStage
 * above no longer needs it). It is what makes the admin churn list, the
 * outreach segments and every future query tell the truth about who is paying:
 * nobody, so far.
 */
export function shouldMarkExpired(business) {
  if (business?.subscription_status !== 'active') return false;
  return !planStatus(business).isPro;
}
