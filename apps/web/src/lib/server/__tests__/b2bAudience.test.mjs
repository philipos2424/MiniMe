import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityTier, selectByActivity } from '../b2bAudience.mjs';

const NOW = new Date('2026-08-14T00:00:00Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString();

test('activityTier classifies never-active businesses correctly', () => {
  assert.equal(activityTier({ last_active_date: null }), 'never');
  assert.equal(activityTier({}), 'never');
});

test('activityTier requires both recency AND onboarding for "active"', () => {
  assert.equal(activityTier({ last_active_date: daysAgo(10), onboarding_completed: true }, NOW), 'active');
  // Recently active but never finished onboarding — not the strong signal.
  assert.equal(activityTier({ last_active_date: daysAgo(10), onboarding_completed: false }, NOW), 'warm');
});

test('activityTier buckets warm (31-90d) and dormant (>90d)', () => {
  assert.equal(activityTier({ last_active_date: daysAgo(60), onboarding_completed: true }, NOW), 'warm');
  assert.equal(activityTier({ last_active_date: daysAgo(200), onboarding_completed: true }, NOW), 'dormant');
});

test('selectByActivity prefers active, falls back to warm, never reaches dormant or never', () => {
  const active1 = { id: 'a1', last_active_date: daysAgo(5), onboarding_completed: true };
  const warm1 = { id: 'w1', last_active_date: daysAgo(50), onboarding_completed: true };
  const dormant1 = { id: 'd1', last_active_date: daysAgo(200), onboarding_completed: true };
  const never1 = { id: 'n1', last_active_date: null };

  const result = selectByActivity([active1, warm1, dormant1, never1], { count: 5, now: NOW });
  assert.deepEqual(result.selected.map(b => b.id), ['a1', 'w1']);
  assert.equal(result.shortfall, true);
  assert.match(result.message, /2 more registered businesses/);
});

test('selectByActivity never pads with dormant/never even if active+warm cannot fill the slots', () => {
  const active1 = { id: 'a1', last_active_date: daysAgo(5), onboarding_completed: true };
  const dormant1 = { id: 'd1', last_active_date: daysAgo(200), onboarding_completed: true };
  const result = selectByActivity([active1, dormant1], { count: 5, now: NOW });
  assert.deepEqual(result.selected.map(b => b.id), ['a1']);
  assert.ok(!result.selected.some(b => b.id === 'd1'));
  assert.equal(result.shortfall, true);
});

test('selectByActivity reports no shortfall when active alone fills the count', () => {
  const candidates = Array.from({ length: 5 }, (_, i) => ({
    id: `a${i}`, last_active_date: daysAgo(1), onboarding_completed: true,
  }));
  const result = selectByActivity(candidates, { count: 3, now: NOW });
  assert.equal(result.selected.length, 3);
  assert.equal(result.shortfall, false);
  assert.equal(result.message, null);
});
