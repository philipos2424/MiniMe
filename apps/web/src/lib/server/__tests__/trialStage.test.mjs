/**
 * The nudge engine could not see the people it most needed to reach.
 *
 * bulk-activate-trials comped 30 days of Pro to every shop then on trial by
 * writing subscription_status='active' with a dated subscription_expires_at.
 * 543 of those windows closed in the week of 3 August 2026. The shops silently
 * dropped to Free — planStatus() reads the date correctly — and MiniMe stopped
 * auto-sending for 651 of them.
 *
 * Nobody was told, because evalTrialStage() opened with
 *
 *     if (tier === 'pro' || subscription_status === 'active' || ...) return false;
 *
 * and 'active' is the exact status the comp had written. 658 shops with a
 * lapsed window carry trial_warn_stage = NULL to this day: not one warning,
 * not one expiry notice, not one win-back, ever.
 *
 * The rule these tests pin: an entitlement is judged by its DATES, never by
 * the status string. Only an undated deliberate grant (plan_tier='pro') and an
 * explicit opt-out ('cancelled') are exempt — matching lib/plan.js exactly, so
 * the two can't drift into disagreeing about who is entitled.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessEndsAt, evalTrialStage, shouldMarkExpired } from '../trialStage.mjs';

const DAY = 86400000;
const NOW = Date.parse('2026-09-04T09:00:00Z');
const future = d => new Date(NOW + d * DAY).toISOString();
const past = d => new Date(NOW - d * DAY).toISOString();

// A shop reachable on Telegram, with no nudge yet sent — the shape of all 658.
const comped = extra => ({
  owner_private_chat_id: 12345,
  plan_tier: 'free',
  subscription_status: 'active',
  trial_ends_at: past(45),
  subscription_expires_at: past(32),
  trial_warn_stage: null,
  ...extra,
});

const WARN_3 = { phase: 'warn', at_or_below_days: 3, stage_value: 3 };
const EXPIRED = { phase: 'expired', stage_value: 0 };
const WINBACK_7 = { phase: 'winback', after_days: 7, stage_value: -7 };

// ── accessEndsAt: when did their access actually run out? ───────────────────

test('a comped grant ends on its own window, not on the older trial date', () => {
  // The 658 all carry a trial_ends_at from before the comp. Reading that first
  // would date every notice ~2 weeks early and word it as a trial expiry.
  assert.equal(
    accessEndsAt(comped()),
    Date.parse(past(32)));
});

test('a plain trial ends on trial_ends_at', () => {
  assert.equal(
    accessEndsAt({ subscription_status: 'trial', trial_ends_at: past(3) }),
    Date.parse(past(3)));
});

test('a shop with neither date cannot be staged', () => {
  assert.equal(accessEndsAt({ subscription_status: 'active' }), null);
});

// ── The defect itself ───────────────────────────────────────────────────────

test('a lapsed comped grant is eligible for the expiry notice', () => {
  assert.equal(evalTrialStage(comped(), EXPIRED, NOW), true);
});

test('a lapsed comped grant is eligible for win-back once far enough past', () => {
  assert.equal(evalTrialStage(comped({ trial_warn_stage: 0 }), WINBACK_7, NOW), true);
});

test('a comped grant about to lapse gets warned before we switch it off', () => {
  // Nobody got this message in August. It is the whole point of the fix.
  const ending = comped({ subscription_expires_at: future(2) });
  assert.equal(evalTrialStage(ending, WARN_3, NOW), true);
});

test('a comped grant still well inside its window is left alone', () => {
  const live = comped({ subscription_expires_at: future(20) });
  assert.equal(evalTrialStage(live, WARN_3, NOW), false);
  assert.equal(evalTrialStage(live, EXPIRED, NOW), false);
});

test('active with no expiry at all is lapsed, not entitled', () => {
  // planStatus() already refuses to call this Pro (nullExpiryEntitlement.test).
  // The nudge engine must agree, or 54 accounts stay silent forever.
  const undated = comped({ subscription_expires_at: null });
  assert.equal(evalTrialStage(undated, EXPIRED, NOW), true);
});

// ── The exemptions, which must survive the fix ──────────────────────────────

test('an undated plan_tier grant is never nudged', () => {
  assert.equal(evalTrialStage(comped({ plan_tier: 'pro' }), EXPIRED, NOW), false);
});

test('a cancelled account is never nudged', () => {
  assert.equal(
    evalTrialStage(comped({ subscription_status: 'cancelled' }), EXPIRED, NOW),
    false);
});

test('a shop we cannot reach on Telegram is never staged', () => {
  assert.equal(
    evalTrialStage(comped({ owner_private_chat_id: null }), EXPIRED, NOW),
    false);
});

test('a stage already sent is not sent again', () => {
  assert.equal(evalTrialStage(comped({ trial_warn_stage: 0 }), EXPIRED, NOW), false);
  assert.equal(evalTrialStage(comped({ trial_warn_stage: -7 }), WINBACK_7, NOW), false);
});

// ── Existing trial behaviour, unchanged ─────────────────────────────────────

test('a trial with 2 days left still gets the 3-day warning', () => {
  const t = { owner_private_chat_id: 1, subscription_status: 'trial', trial_ends_at: future(2) };
  assert.equal(evalTrialStage(t, WARN_3, NOW), true);
});

test('a trial with 10 days left is not warned yet', () => {
  const t = { owner_private_chat_id: 1, subscription_status: 'trial', trial_ends_at: future(10) };
  assert.equal(evalTrialStage(t, WARN_3, NOW), false);
});

test('an ended trial gets the expiry notice', () => {
  const t = { owner_private_chat_id: 1, subscription_status: 'trial', trial_ends_at: past(1) };
  assert.equal(evalTrialStage(t, EXPIRED, NOW), true);
});

// ── shouldMarkExpired: stop the status column from lying ────────────────────

test('an active row whose window has closed is reconciled to expired', () => {
  assert.equal(shouldMarkExpired(comped()), true);
});

test('an active row with a live window is left alone', () => {
  assert.equal(shouldMarkExpired(comped({ subscription_expires_at: future(20) })), false);
});

test('an undated plan_tier grant keeps its active status', () => {
  // Deliberate permanent grants are a separate door and this one must not
  // close it — planStatus() honours plan_tier unconditionally.
  assert.equal(shouldMarkExpired(comped({ plan_tier: 'pro' })), false);
});

test('a trial is not reconciled by this cron', () => {
  // Trials expire through their own stage ladder; only 'active' rows lie.
  assert.equal(
    shouldMarkExpired({ subscription_status: 'trial', trial_ends_at: past(5) }),
    false);
});

test('a row already marked expired is not rewritten', () => {
  assert.equal(
    shouldMarkExpired({ subscription_status: 'expired', subscription_expires_at: past(5) }),
    false);
});
