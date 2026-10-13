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

test('Pro is the single paid plan at 1,300 ETB/month', () => {
  assert.ok(SUBSCRIPTION_PLANS.pro);
  assert.equal(SUBSCRIPTION_PLANS.pro.priceMonthlyEtb, 1300);
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

test('planPriceEtb uses the Pro period prices and falls back for legacy rows', () => {
  assert.equal(planPriceEtb(SUBSCRIPTION_PLANS.pro), 1300);
  assert.equal(planPriceEtb(SUBSCRIPTION_PLANS.pro, 3), 3500);
  assert.equal(planPriceEtb(SUBSCRIPTION_PLANS.pro, 12), 12000);
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

test('a verified payment maps back to the period it covers', async () => {
  const { periodForAmount, periodForMonths, PRO_PERIODS } = await import('../../plan.js');
  assert.equal(periodForAmount(1300).key, 'pro_monthly');
  assert.equal(periodForAmount(3498).key, 'pro_quarterly'); // within 5 ETB
  assert.equal(periodForAmount(12000).key, 'pro_annual');
  assert.equal(periodForAmount(5000).key, 'pro_quarterly'); // never more than paid for
  assert.equal(periodForMonths(6), null); // unsold durations are refused
  assert.deepEqual(Object.values(PRO_PERIODS).map(p => p.months), [1, 3, 12]);
});

test('a payment under review keeps the access the owner already had', async () => {
  const { planStatus } = await import('../../plan.js');
  const { planStatusServer } = await import('../planGuard.js');
  const inDays = n => new Date(Date.now() + n * 86400000).toISOString();
  for (const status of [planStatus, planStatusServer]) {
    // Paid for 3 months mid-trial: still Pro while the transfer is reviewed.
    assert.equal(status({ subscription_status: 'pending_review', trial_ends_at: inDays(5) }).isPro, true);
    // Renewing early: still Pro until the current period runs out.
    assert.equal(status({ subscription_status: 'pending_review', subscription_expires_at: inDays(10) }).isPro, true);
    // Nothing left to keep: review alone grants nothing.
    assert.equal(status({ subscription_status: 'pending_review', trial_ends_at: inDays(-1) }).isPro, false);
    assert.equal(status({ subscription_status: 'pending_review' }).isPro, false);
  }
});


test('Free runs the full agent for 100 AI replies a month, then drafts', async () => {
  const { effectiveTrustLevel, trustLevelForReply, freeAiRepliesLeft, aiReplyPeriod, FREE_LIMITS } = await import('../../plan.js');
  const period = aiReplyPeriod();
  const free = (extra = {}) => ({ trust_level: 2, plan_tier: 'free', subscription_status: 'expired', ...extra });
  assert.equal(FREE_LIMITS.aiRepliesPerMonth, 100);

  // Per reply: the count after bumping decides.
  assert.equal(trustLevelForReply(free(), 1), 2);
  assert.equal(trustLevelForReply(free(), 100), 2);
  assert.equal(trustLevelForReply(free(), 101), 1);
  // Counter unavailable: draft, never unlimited auto-send.
  assert.equal(trustLevelForReply(free(), null), 1);
  // Pro is never limited.
  assert.equal(trustLevelForReply({ trust_level: 3, plan_tier: 'pro' }, 5000), 3);

  // From the row (UI, crons): allowance left this month.
  assert.equal(freeAiRepliesLeft(free({ ai_replies_period: period, ai_replies_count: 40 })), 60);
  assert.equal(freeAiRepliesLeft(free({ ai_replies_period: '2000-01', ai_replies_count: 999 })), 100); // new month
  assert.equal(freeAiRepliesLeft(free()), 0); // no counter columns → treated as used up
  assert.equal(effectiveTrustLevel(free({ ai_replies_period: period, ai_replies_count: 40 })), 2);
  assert.equal(effectiveTrustLevel(free({ ai_replies_period: period, ai_replies_count: 100 })), 1);
});
