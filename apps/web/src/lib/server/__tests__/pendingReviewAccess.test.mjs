/**
 * Recording a payment must not change entitlement.
 *
 * This used to require special-casing: 'pending_review' was written into
 * subscription_status, so planStatus() had to detect it and reconstruct the
 * access the write had just destroyed — first by preserving what the shop had,
 * then by freezing its expiry, then by anchoring that freeze so re-uploading
 * couldn't extend it. Three fixes, each caused by the one before.
 *
 * With payment_state separate there is nothing to reconstruct. planStatus()
 * does not know reviews exist, and these tests exist to keep it that way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planStatus } from '../../plan.js';

const DAY = 86400000;
const future = d => new Date(Date.now() + d * DAY).toISOString();
const past = d => new Date(Date.now() - d * DAY).toISOString();

test('payment_state never changes entitlement', () => {
  const base = { plan_tier: 'free', subscription_status: 'trial', trial_ends_at: future(20) };
  const expected = planStatus(base).isPro;
  for (const s of [null, 'awaiting_proof', 'in_review', 'verifying', 'rejected']) {
    assert.equal(planStatus({ ...base, payment_state: s }).isPro, expected,
      `payment_state '${s}' altered entitlement`);
  }
});

test('a trialing shop that uploads proof is still on trial', () => {
  const b = { plan_tier: 'free', subscription_status: 'trial', trial_ends_at: future(20), payment_state: 'in_review' };
  assert.equal(planStatus(b).isPro, true);
  assert.equal(planStatus(b).onTrial, true);
  assert.ok(planStatus(b).trialDaysLeft > 0);
});

test('an active subscriber renewing keeps access', () => {
  const b = { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: future(10), payment_state: 'in_review' };
  assert.equal(planStatus(b).isPro, true);
});

test('an expired shop is not rescued by having a payment in review', () => {
  const b = { plan_tier: 'free', subscription_status: 'expired', trial_ends_at: past(40), payment_state: 'in_review' };
  assert.equal(planStatus(b).isPro, false);
});

test('planStatus no longer mentions reviews at all', () => {
  const root = process.cwd().replace(/apps[\\/]web$/, '');
  for (const p of ['apps/web/src/lib/plan.js', 'packages/shared/plan.js']) {
    const src = readFileSync(`${root}${p}`, 'utf8');
    const fn = src.match(/function planStatus\(business\)[\s\S]*?\n\}/)[0];
    assert.ok(!/pending_review|inReview|reviewSub|asOf|REVIEW_HOLD/.test(fn),
      `${p} still special-cases reviews`);
  }
});

test('the bot and the mini-app agree about who is Pro', async () => {
  // packages/shared/plan.js is a hand-maintained mirror backing the bot's
  // effectiveTrustLevel(). Drift means a merchant keeps Pro in the mini-app
  // while silently dropping to Free autonomy mid-conversation.
  const shared = await import('../../../../../../packages/shared/plan.js');
  const cases = [
    { plan_tier: 'free', subscription_status: 'trial', trial_ends_at: future(3) },
    { plan_tier: 'free', subscription_status: 'trial', trial_ends_at: past(1) },
    { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: future(10) },
    { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: past(5) },
    { plan_tier: 'free', subscription_status: 'active' },
    { plan_tier: 'free', subscription_status: 'expired', payment_state: 'in_review' },
    { plan_tier: 'pro', subscription_status: 'expired' },
  ];
  for (const biz of cases) {
    assert.equal(shared.planStatus(biz).isPro, planStatus(biz).isPro,
      `mirrors disagree for ${JSON.stringify(biz)}`);
  }
});
