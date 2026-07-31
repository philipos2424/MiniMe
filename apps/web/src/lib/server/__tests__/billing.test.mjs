import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSCRIPTION_PLANS,
  getActiveBillingStrategy,
  setBillingStrategy
} from '../billing.js';

test('SUBSCRIPTION_PLANS contains all required SaaS plans', () => {
  assert.ok(SUBSCRIPTION_PLANS.free);
  assert.equal(SUBSCRIPTION_PLANS.free.chats, 50);

  assert.ok(SUBSCRIPTION_PLANS.business);
  assert.equal(SUBSCRIPTION_PLANS.business.chats, 200);
  assert.equal(SUBSCRIPTION_PLANS.business.priceMonthlyUsd, 8);

  assert.ok(SUBSCRIPTION_PLANS.professional);
  assert.equal(SUBSCRIPTION_PLANS.professional.chats, -1);
  assert.equal(SUBSCRIPTION_PLANS.professional.priceMonthlyUsd, 15);
});

test('CreditStrategy blocks when remaining credits <= 0', () => {
  const strategy = getActiveBillingStrategy();

  const zeroSub = { status: 'active', credits_remaining: 0 };
  const accessZero = strategy.checkAccess(zeroSub);
  assert.equal(accessZero.allowed, false);
  assert.equal(accessZero.error, 'No AI credits remaining.');

  const activeSub = { status: 'active', credits_remaining: 3 };
  const accessActive = strategy.checkAccess(activeSub);
  assert.equal(accessActive.allowed, true);
  assert.equal(accessActive.remaining, 3);

  const unlimitedSub = { status: 'active', credits_remaining: -1 };
  const accessUnlimited = strategy.checkAccess(unlimitedSub);
  assert.equal(accessUnlimited.allowed, true);
  assert.equal(accessUnlimited.unlimited, true);
});

test('BillingStrategy mode switching works for future token/unlimited extensions', () => {
  setBillingStrategy('unlimited');
  const strategy = getActiveBillingStrategy();
  const zeroSub = { status: 'active', credits_remaining: 0 };
  const access = strategy.checkAccess(zeroSub);
  assert.equal(access.allowed, true);
  assert.equal(access.unlimited, true);

  // Reset back to credits
  setBillingStrategy('credits');
  const creditStrategy = getActiveBillingStrategy();
  assert.equal(creditStrategy.checkAccess(zeroSub).allowed, false);
});
