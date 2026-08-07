import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSCRIPTION_PLANS,
  PURCHASABLE_PLANS,
  planPriceEtb,
  getActiveBillingStrategy,
  setBillingStrategy
} from '../billing.js';

test('Free is uncapped — MiniMe answering customers is never metered', () => {
  assert.ok(SUBSCRIPTION_PLANS.free);
  // -1 is the "unlimited" sentinel. Free is FEATURE-gated, not usage-capped;
  // it used to be 50 chats, which hard-blocked replies once exhausted.
  assert.equal(SUBSCRIPTION_PLANS.free.chats, -1);
  assert.equal(SUBSCRIPTION_PLANS.free.priceMonthlyEtb, 0);
});

test('Pro is the single paid plan at 1,999 ETB/month', () => {
  assert.ok(SUBSCRIPTION_PLANS.pro);
  assert.equal(SUBSCRIPTION_PLANS.pro.priceMonthlyEtb, 1999);
  assert.equal(SUBSCRIPTION_PLANS.pro.chats, -1);

  assert.deepEqual(PURCHASABLE_PLANS.map(p => p.id), ['pro']);
});

test('retired USD credit tiers still resolve but are never sellable', () => {
  assert.ok(SUBSCRIPTION_PLANS.business);
  assert.equal(SUBSCRIPTION_PLANS.business.chats, 200);
  assert.equal(SUBSCRIPTION_PLANS.business.priceMonthlyUsd, 8);
  assert.equal(SUBSCRIPTION_PLANS.business.legacy, true);

  assert.ok(SUBSCRIPTION_PLANS.professional);
  assert.equal(SUBSCRIPTION_PLANS.professional.chats, -1);
  assert.equal(SUBSCRIPTION_PLANS.professional.priceMonthlyUsd, 15);
  assert.equal(SUBSCRIPTION_PLANS.professional.legacy, true);

  for (const p of PURCHASABLE_PLANS) assert.notEqual(p.legacy, true);
});

test('planPriceEtb multiplies by duration and falls back for legacy rows', () => {
  assert.equal(planPriceEtb(SUBSCRIPTION_PLANS.pro), 1999);
  assert.equal(planPriceEtb(SUBSCRIPTION_PLANS.pro, 3), 5997);
  // A plan def with no ETB price falls back to the old ~150 birr/USD rate.
  assert.equal(planPriceEtb({ priceMonthlyUsd: 10 }, 1), 1500);
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
