/**
 * A subscription with no end date is not a subscription.
 *
 * planStatus() read `status === 'active' && (!expiresAt || expiresAt > now)`,
 * so a NULL subscription_expires_at resolved to permanent Pro. 31 accounts
 * reached free-forever access through that branch alone — written by an admin
 * button that set the status and never a window — and because the entitlement
 * check already considered them paid, no paywall could ever fire against them.
 * Among them was the single highest-volume shop on the platform.
 *
 * paymentGrantGuards.test.mjs pins the shape of the fix in the source. This
 * pins the behaviour, in both copies of planStatus: apps/web/src/lib/plan.js
 * and its hand-maintained CommonJS mirror in packages/shared, which apps/bot
 * consumes. The two drifting apart is how an account ends up entitled by one
 * and not the other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planStatus } from '../../plan.js';

const require = createRequire(import.meta.url);
const shared = require('../../../../../../packages/shared/plan.js');

const DAY = 86400000;
const future = d => new Date(Date.now() + d * DAY).toISOString();
const past = d => new Date(Date.now() - d * DAY).toISOString();

// Both implementations must answer identically for every case below.
const both = business => {
  const a = planStatus(business).isPro;
  const b = shared.planStatus(business).isPro;
  assert.equal(a, b,
    `apps/web and packages/shared disagree on ${JSON.stringify(business)}`);
  return a;
};

test('active with no expiry is NOT Pro', () => {
  assert.equal(both({ plan_tier: 'free', subscription_status: 'active' }), false);
  assert.equal(
    both({ plan_tier: 'free', subscription_status: 'active', subscription_expires_at: null }),
    false);
});

test('active with a live expiry IS Pro', () => {
  assert.equal(
    both({ plan_tier: 'free', subscription_status: 'active', subscription_expires_at: future(30) }),
    true);
});

test('active with a lapsed expiry is not Pro', () => {
  assert.equal(
    both({ plan_tier: 'free', subscription_status: 'active', subscription_expires_at: past(1) }),
    false);
});

test('an explicit plan_tier grant is still honoured without any window', () => {
  // Deliberate grants are a separate door, closed separately by
  // grant_expiry_heavy_users.sql. Tightening the null-expiry read must not
  // quietly revoke them too.
  assert.equal(both({ plan_tier: 'pro', subscription_status: 'active' }), true);
  assert.equal(both({ plan_tier: 'pro', subscription_status: 'expired' }), true);
});

test('a live trial is unaffected', () => {
  assert.equal(
    both({ plan_tier: 'free', subscription_status: 'trial', trial_ends_at: future(10) }),
    true);
  assert.equal(
    both({ plan_tier: 'free', subscription_status: 'trial', trial_ends_at: past(1) }),
    false);
});

test('the migration cohort keeps access until its window lapses', () => {
  // close_null_expiry_pro_door.sql gives every affected row `now() + 14 days`.
  // The whole point of running it before this code change is that these shops
  // notice nothing on deploy day.
  const migrated = {
    plan_tier: 'free',
    subscription_status: 'active',
    subscription_expires_at: future(14),
  };
  assert.equal(both(migrated), true, 'a migrated row must not lose access on deploy');

  // ...and reaches Free by the window ending, which is a thing we can warn about.
  assert.equal(
    both({ ...migrated, subscription_expires_at: past(1) }),
    false);
});
