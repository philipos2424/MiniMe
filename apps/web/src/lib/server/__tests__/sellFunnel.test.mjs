import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSellFunnel, chunk } from '../sellFunnel.mjs';

const tap = (id, at) => ({ telegram_id: id, created_at: at });
const biz = (owner, at, done = false) => ({ owner_telegram_id: owner, created_at: at, onboarding_completed: done });

test('counts distinct owners, not business rows', () => {
  const taps = [tap(1, '2026-01-01')];
  const bizs = [biz(1, '2026-01-02', true), biz(1, '2026-01-03')];
  assert.deepEqual(computeSellFunnel(taps, bizs), { tapped: 1, signedUp: 1, activated: 1 });
});

test('ignores businesses created before the earliest tap', () => {
  const taps = [tap(1, '2026-01-05'), tap(1, '2026-01-09')];
  const bizs = [biz(1, '2026-01-02', true)];
  assert.deepEqual(computeSellFunnel(taps, bizs), { tapped: 1, signedUp: 0, activated: 0 });
});

test('attributes a business created between two taps (earliest tap wins)', () => {
  const taps = [tap(1, '2026-01-01'), tap(1, '2026-01-10')];
  const bizs = [biz(1, '2026-01-05')];
  assert.deepEqual(computeSellFunnel(taps, bizs), { tapped: 1, signedUp: 1, activated: 0 });
});

test('normalizes numeric vs string telegram ids', () => {
  const taps = [tap(123456, '2026-01-01')];
  const bizs = [biz('123456', '2026-01-02', true)];
  assert.deepEqual(computeSellFunnel(taps, bizs), { tapped: 1, signedUp: 1, activated: 1 });
});

test('never exceeds the previous step', () => {
  const taps = [tap(1, '2026-01-01'), tap(2, '2026-01-01')];
  const bizs = [biz(1, '2026-01-02'), biz(1, '2026-01-03', true), biz(2, '2026-01-02', true), biz(3, '2026-01-02', true)];
  const f = computeSellFunnel(taps, bizs);
  assert.ok(f.signedUp <= f.tapped);
  assert.ok(f.activated <= f.signedUp);
  assert.deepEqual(f, { tapped: 2, signedUp: 2, activated: 2 });
});

test('missing created_at on a business is treated as pre-existing', () => {
  const taps = [tap(1, '2026-01-01')];
  const bizs = [{ owner_telegram_id: 1, onboarding_completed: true }];
  assert.deepEqual(computeSellFunnel(taps, bizs), { tapped: 1, signedUp: 0, activated: 0 });
});

test('handles null/empty inputs', () => {
  assert.deepEqual(computeSellFunnel(null, null), { tapped: 0, signedUp: 0, activated: 0 });
  assert.deepEqual(computeSellFunnel([{ telegram_id: null }], []), { tapped: 0, signedUp: 0, activated: 0 });
});

test('chunk splits into batches and handles empty arrays', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
  assert.deepEqual(chunk(null, 2), []);
});
