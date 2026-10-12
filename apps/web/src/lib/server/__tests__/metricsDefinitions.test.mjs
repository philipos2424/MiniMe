import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKeyEAT, funnelStep, FUNNEL_STEPS, isInternal, isChainCall, planState, median, eatMidnightIso,
} from '../metrics/definitions.mjs';
import { planStatus } from '../../plan.js';

const future = d => new Date(Date.now() + d * 86400000).toISOString();
const past = d => new Date(Date.now() - d * 86400000).toISOString();

test('21:30 UTC belongs to the next EAT day', () => {
  assert.equal(dayKeyEAT('2026-10-12T21:30:00Z'), '2026-10-13');
  assert.equal(dayKeyEAT('2026-10-12T20:59:59Z'), '2026-10-12');
});

test('eatMidnightIso is 21:00 UTC the previous day', () => {
  assert.equal(eatMidnightIso('2026-10-13'), '2026-10-12T21:00:00.000Z');
});

test('isInternal is true only for an explicit true', () => {
  assert.equal(isInternal({ is_internal: true }), true);
  assert.equal(isInternal({ is_internal: false }), false);
  assert.equal(isInternal({ is_internal: null }), false);
  assert.equal(isInternal({}), false);
});

test('raw provider rows are not chain calls', () => {
  assert.equal(isChainCall({ route: 'raw:openai' }), false);
  assert.equal(isChainCall({ route: 'reply' }), true);
  assert.equal(isChainCall({ route: null }), true);
});

test('funnel steps map aliases and drop unknowns', () => {
  assert.equal(funnelStep('connected_shared'), 'connected');
  assert.equal(funnelStep('connected_custom'), 'connected');
  assert.equal(funnelStep('welcome'), 'welcome');
  assert.equal(funnelStep('tour_started'), null);
  assert.ok(FUNNEL_STEPS.indexOf('welcome') < FUNNEL_STEPS.indexOf('trial_started'));
});

test('planState follows planStatus', () => {
  assert.equal(planState({ subscription_status: 'trial', trial_ends_at: future(5) }), 'trial');
  assert.equal(planState({ plan_tier: 'pro', subscription_status: 'active' }), 'pro');
  assert.equal(planState({ subscription_status: 'active', subscription_expires_at: future(5) }), 'pro');
  assert.equal(planState({ subscription_status: 'trial', trial_ends_at: past(1) }), 'expired');
  const nullExpiry = { subscription_status: 'active', subscription_expires_at: null };
  assert.equal(planState(nullExpiry), planStatus(nullExpiry).isPro ? 'pro' : 'free');
});

test('median', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 9, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 3); // upper-middle, integer seconds
});
