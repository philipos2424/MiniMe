import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getB2BAutonomy, canAutoSendOutreach, canAutoNegotiate, canAutoCloseDeal,
  describeB2BAutonomy, DEFAULT_B2B_AUTONOMY,
} from '../b2bAutonomy.mjs';

// Pro (so effectiveTrustLevel isn't capped by the free-plan ceiling) at a
// given trust_level and b2b_autonomy preference.
const biz = (trustLevel, autonomy, limits = {}) => ({
  trust_level: trustLevel,
  subscription_status: 'active',
  notification_prefs: { b2b_autonomy: autonomy, b2b_limits: limits },
});

test('defaults to review_all when nothing is set — the safest level', () => {
  assert.equal(getB2BAutonomy({}), DEFAULT_B2B_AUTONOMY);
  assert.equal(getB2BAutonomy({ notification_prefs: {} }), 'review_all');
  assert.equal(getB2BAutonomy({ notification_prefs: { b2b_autonomy: 'nonsense' } }), 'review_all');
});

test('review_all never auto-sends outreach or auto-negotiates, regardless of trust', () => {
  const b = biz(3, 'review_all');
  assert.equal(canAutoSendOutreach(b), false);
  assert.equal(canAutoNegotiate(b), false);
});

test('review_deals and full_auto auto-send and auto-negotiate when trust is TRUSTED+', () => {
  for (const level of ['review_deals', 'full_auto']) {
    const b = biz(2, level);
    assert.equal(canAutoSendOutreach(b), true, level);
    assert.equal(canAutoNegotiate(b), true, level);
  }
});

// The core guarantee this module exists for: a low-trust business stays
// locked to manual approval no matter what the stored preference says — the
// dial is a ceiling the trust ladder can lower, never a way around it.
test('trust below TRUSTED overrides ANY autonomy level back to manual approval', () => {
  for (const level of ['review_deals', 'full_auto']) {
    const b = biz(1, level); // SUPERVISED, below TRUSTED
    assert.equal(canAutoSendOutreach(b), false, `${level} at SUPERVISED`);
    assert.equal(canAutoNegotiate(b), false, `${level} at SUPERVISED`);
  }
});

test('only full_auto can close a deal without a human tap', () => {
  const offer = { total: 5000, currency: 'ETB' };
  assert.equal(canAutoCloseDeal(biz(3, 'review_all', { max_budget_buy: 10000 }), offer, 'buy'), false);
  assert.equal(canAutoCloseDeal(biz(3, 'review_deals', { max_budget_buy: 10000 }), offer, 'buy'), false);
  assert.equal(canAutoCloseDeal(biz(3, 'full_auto', { max_budget_buy: 10000 }), offer, 'buy'), true);
});

test('full_auto still cannot close outside the owner-set price limits', () => {
  const overBudget = { total: 15000 };
  const b = biz(3, 'full_auto', { max_budget_buy: 10000 });
  assert.equal(canAutoCloseDeal(b, overBudget, 'buy'), false);
});

test('full_auto with no limit configured never auto-closes — an unset ceiling is not an unlimited one', () => {
  const b = biz(3, 'full_auto', {}); // no max_budget_buy at all
  assert.equal(canAutoCloseDeal(b, { total: 1 }, 'buy'), false);
});

test('sell-direction checks the floor, not the ceiling', () => {
  const b = biz(3, 'full_auto', { min_sell_price: 20000 });
  assert.equal(canAutoCloseDeal(b, { total: 25000 }, 'sell'), true);
  assert.equal(canAutoCloseDeal(b, { total: 15000 }, 'sell'), false);
});

test('a deal with no verifiable numeric amount never auto-closes', () => {
  const b = biz(3, 'full_auto', { max_budget_buy: 10000 });
  assert.equal(canAutoCloseDeal(b, {}, 'buy'), false);
  assert.equal(canAutoCloseDeal(b, { total: 'a lot' }, 'buy'), false);
});

test('describeB2BAutonomy explains every level in plain language', () => {
  for (const level of ['review_all', 'review_deals', 'full_auto']) {
    const desc = describeB2BAutonomy(level);
    assert.equal(typeof desc, 'string');
    assert.ok(desc.length > 20);
  }
});
