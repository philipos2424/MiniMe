/**
 * The autonomy paywall: Free writes the reply, Pro sends it.
 *
 * These tests exist because this gate is the whole business model AND the
 * riskiest thing in the codebase to get wrong — a bug here either silently
 * stops every Free shop's replies from going out (churn) or gives autonomy
 * away (no revenue).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveTrustLevel, isTrustLevelCapped, FREE_MAX_TRUST_LEVEL, planStatus,
} from '../../plan.js';
import { TRUST_LEVELS } from '../constants.js';

// replyEngine.js can't be imported here — it uses extensionless specifiers that
// only the Next bundler resolves. Its contract is fixed and simple, though:
// shouldAutoSend() returns false for anything below TRUSTED ("SHADOW +
// SUPERVISED always draft"), so asserting the effective level against that
// threshold tests the same guarantee without dragging the engine in.
const autoSends = level => level >= TRUST_LEVELS.TRUSTED;

const PRO     = { plan_tier: 'pro', subscription_status: 'active' };
const FREE    = { plan_tier: 'free', subscription_status: 'expired' };
const ONTRIAL = {
  plan_tier: 'free',
  subscription_status: 'trial',
  trial_ends_at: new Date(Date.now() + 5 * 86400000).toISOString(),
};

test('FREE_MAX_TRUST_LEVEL agrees with TRUST_LEVELS.SUPERVISED', () => {
  // plan.js keeps this as a literal to stay dependency-free/client-safe.
  // If someone renumbers the trust ladder, this is the tripwire.
  assert.equal(FREE_MAX_TRUST_LEVEL, TRUST_LEVELS.SUPERVISED);
});

test('Free is capped at SUPERVISED however high it is set', () => {
  assert.equal(effectiveTrustLevel({ ...FREE, trust_level: TRUST_LEVELS.FULL_AGENT }), TRUST_LEVELS.SUPERVISED);
  assert.equal(effectiveTrustLevel({ ...FREE, trust_level: TRUST_LEVELS.TRUSTED }), TRUST_LEVELS.SUPERVISED);
});

test('Free can still go BELOW the cap — Shadow stays Shadow', () => {
  // The cap is a ceiling, not a floor. An owner who deliberately chose Shadow
  // (observe only) must not be forced up into drafting.
  assert.equal(effectiveTrustLevel({ ...FREE, trust_level: TRUST_LEVELS.SHADOW }), TRUST_LEVELS.SHADOW);
});

test('Pro and trial shops keep the level they chose', () => {
  assert.equal(effectiveTrustLevel({ ...PRO, trust_level: TRUST_LEVELS.FULL_AGENT }), TRUST_LEVELS.FULL_AGENT);
  assert.equal(effectiveTrustLevel({ ...ONTRIAL, trust_level: TRUST_LEVELS.FULL_AGENT }), TRUST_LEVELS.FULL_AGENT);
});

test('the stored level is never mutated — upgrading restores it exactly', () => {
  const business = { ...FREE, trust_level: TRUST_LEVELS.FULL_AGENT };
  const snapshot = { ...business };
  effectiveTrustLevel(business);
  isTrustLevelCapped(business);
  assert.deepEqual(business, snapshot, 'effectiveTrustLevel must be pure');

  // Same row, now paying → their original choice is live again immediately.
  assert.equal(effectiveTrustLevel({ ...business, ...PRO }), TRUST_LEVELS.FULL_AGENT);
});

test('isTrustLevelCapped flags exactly the shops running below their setting', () => {
  assert.equal(isTrustLevelCapped({ ...FREE, trust_level: TRUST_LEVELS.TRUSTED }), true);
  assert.equal(isTrustLevelCapped({ ...FREE, trust_level: TRUST_LEVELS.SUPERVISED }), false);
  assert.equal(isTrustLevelCapped({ ...PRO,  trust_level: TRUST_LEVELS.FULL_AGENT }), false);
});

test('a missing trust_level defaults to SUPERVISED, never to silence', () => {
  // The bot dispatches on this with a switch that has no default case; a
  // non-numeric subject matched nothing and the customer got no reply at all.
  assert.equal(effectiveTrustLevel({ ...FREE }), TRUST_LEVELS.SUPERVISED);
  assert.equal(effectiveTrustLevel(null), TRUST_LEVELS.SUPERVISED);
  assert.equal(effectiveTrustLevel({}), TRUST_LEVELS.SUPERVISED);
});

test('a Free shop never reaches the auto-send threshold, however it is set', () => {
  assert.equal(autoSends(effectiveTrustLevel({ ...FREE, trust_level: TRUST_LEVELS.FULL_AGENT })), false);
  assert.equal(autoSends(effectiveTrustLevel({ ...FREE, trust_level: TRUST_LEVELS.TRUSTED })), false);
});

test('a paying shop at TRUSTED does reach it', () => {
  assert.equal(autoSends(effectiveTrustLevel({ ...PRO, trust_level: TRUST_LEVELS.TRUSTED })), true);
});

test('the trial delivers the full Pro experience — that is what makes the ask land', () => {
  assert.equal(autoSends(effectiveTrustLevel({ ...ONTRIAL, trust_level: TRUST_LEVELS.TRUSTED })), true);
  assert.equal(planStatus(ONTRIAL).isPro, true);
});
