/**
 * Access while a payment is under review.
 *
 * subscription_status carries BOTH the payment state and the entitlement
 * state, so writing 'pending_review' overwrites whatever the shop had. Once
 * proof uploads stopped auto-activating, that meant a merchant on day 3 of
 * their trial who uploaded a screenshot stopped being on trial the instant
 * they paid us — paying bought them strictly less than not paying, while they
 * waited on an approval that hadn't happened yet.
 *
 * These tests pin the rule: review never reduces access, and never grants
 * unlimited access either.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStatus } from '../../plan.js';

const DAY = 86400000;
const future = d => new Date(Date.now() + d * DAY).toISOString();
const past = d => new Date(Date.now() - d * DAY).toISOString();

test('a trialing shop keeps its trial while payment is reviewed', () => {
  const before = planStatus({ plan_tier: 'free', subscription_status: 'trial', trial_ends_at: future(20) });
  const after = planStatus({ plan_tier: 'free', subscription_status: 'pending_review', trial_ends_at: future(20) });

  assert.equal(before.isPro, true);
  assert.equal(after.isPro, true, 'paying during a trial revoked access');
  assert.equal(after.onTrial, true);
  assert.ok(after.trialDaysLeft > 0, 'trial days left reads as zero under review');
});

test('an active subscriber renewing keeps access while reviewed', () => {
  const after = planStatus({
    plan_tier: 'free',
    subscription_status: 'pending_review',
    subscription_expires_at: future(10),
  });
  assert.equal(after.isPro, true, 'renewing mid-term revoked access');
});

test('review does not resurrect an already-expired subscription', () => {
  const after = planStatus({
    plan_tier: 'free',
    subscription_status: 'pending_review',
    subscription_expires_at: past(5),
    trial_ends_at: past(40),
  });
  assert.equal(after.isPro, false, 'an expired shop got Pro back by uploading a screenshot');
});

test('review with no dates at all grants nothing', () => {
  // The important one: a null expiry means "unlimited" for status='active'.
  // If pending_review reused that allowance, uploading any image would be a
  // route to permanent free Pro — exactly the hole this all exists to close.
  const after = planStatus({ plan_tier: 'free', subscription_status: 'pending_review' });
  assert.equal(after.isPro, false, 'uploading a screenshot granted unlimited Pro');
});

test('the clock is held while review is outstanding', () => {
  // Paid on the last day of the trial; two days of our review time have passed.
  const biz = {
    plan_tier: 'free',
    subscription_status: 'pending_review',
    trial_ends_at: past(2),
    payment_submitted_at: past(2.1),
  };
  assert.equal(planStatus(biz).isPro, true,
    'our review time cost the merchant their access');
});

test('the hold expires so an unreviewed upload never becomes permanent', () => {
  const biz = {
    plan_tier: 'free',
    subscription_status: 'pending_review',
    trial_ends_at: past(40),
    payment_submitted_at: past(40),   // well past REVIEW_HOLD_DAYS
  };
  assert.equal(planStatus(biz).isPro, false,
    'an upload nobody reviewed granted indefinite access');
});

test('the hold degrades safely when the column has not been migrated', () => {
  // payment_submitted_at absent → no hold, but access already held is kept.
  const stillOnTrial = planStatus({
    plan_tier: 'free', subscription_status: 'pending_review', trial_ends_at: future(5),
  });
  assert.equal(stillOnTrial.isPro, true);

  const lapsed = planStatus({
    plan_tier: 'free', subscription_status: 'pending_review', trial_ends_at: past(1),
  });
  assert.equal(lapsed.isPro, false);
});

test('the bot and the mini-app agree about who is Pro', async () => {
  // packages/shared/plan.js is a hand-maintained mirror backing the bot's
  // effectiveTrustLevel(). Drift means a merchant under review keeps Pro in the
  // mini-app while silently dropping to Free autonomy mid-conversation.
  const shared = await import('../../../../../../packages/shared/plan.js');
  const cases = [
    { plan_tier: 'free', subscription_status: 'pending_review', trial_ends_at: future(20) },
    { plan_tier: 'free', subscription_status: 'pending_review', subscription_expires_at: future(10) },
    { plan_tier: 'free', subscription_status: 'pending_review', subscription_expires_at: past(5) },
    { plan_tier: 'free', subscription_status: 'pending_review' },
    { plan_tier: 'free', subscription_status: 'trial', trial_ends_at: future(3) },
    { plan_tier: 'pro', subscription_status: 'expired' },
    // The hold, held and lapsed — REVIEW_HOLD_DAYS must match in both copies.
    { plan_tier: 'free', subscription_status: 'pending_review', trial_ends_at: past(2), payment_submitted_at: past(2.1) },
    { plan_tier: 'free', subscription_status: 'pending_review', trial_ends_at: past(40), payment_submitted_at: past(40) },
  ];
  for (const biz of cases) {
    assert.equal(
      shared.planStatus(biz).isPro,
      planStatus(biz).isPro,
      `mirrors disagree for ${JSON.stringify(biz)}`);
  }
});
