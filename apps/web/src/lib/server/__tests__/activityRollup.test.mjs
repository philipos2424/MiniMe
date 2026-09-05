/**
 * Keeping last_shop_activity_date true after the backfill.
 *
 * Migration 051 split "the owner showed up" (last_active_date, a streak
 * written only when an owner messages their own shop bot — so NULL for the 935
 * shops that never linked one) from "the shop is alive"
 * (last_shop_activity_date), and backfilled the new column from message
 * traffic. b2bAudience.activityTier() and browseRank.activityLabel() both read
 * it: it decides who gets outreach and how a shop ranks in the directory.
 *
 * A backfill with nothing keeping it current is the same bug on a delay — the
 * column is true the day it lands and drifts every day after. This is the
 * rollup that keeps it honest, and these are the rules it has to follow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addisDay, pendingActivityUpdates } from '../activityRollup.mjs';

const biz = (id, iso) => ({ business_id: id, created_at: iso });

test('a calendar day is the day it was in Addis, not in UTC', () => {
  // Ethiopia is UTC+3 with no DST. 22:30 UTC on the 3rd is already the 4th for
  // the shop, and gamification.todayInAddis() applies the same offset.
  assert.equal(addisDay('2026-09-03T22:30:00Z'), '2026-09-04');
  assert.equal(addisDay('2026-09-03T20:59:00Z'), '2026-09-03');
});

test('each shop is stamped with its most recent message day', () => {
  const updates = pendingActivityUpdates([
    biz('a', '2026-09-01T08:00:00Z'),
    biz('a', '2026-09-03T08:00:00Z'),
    biz('a', '2026-09-02T08:00:00Z'),
  ], {});
  assert.deepEqual(updates, [{ id: 'a', last_shop_activity_date: '2026-09-03' }]);
});

test('a shop already stamped with today is not rewritten', () => {
  // The whole point of the diff — a nightly UPDATE across every active shop
  // costs the same as one across the handful that actually moved.
  const updates = pendingActivityUpdates(
    [biz('a', '2026-09-03T08:00:00Z')],
    { a: '2026-09-03' });
  assert.deepEqual(updates, []);
});

test('liveness never moves backwards', () => {
  // A late-arriving or backdated row must not un-age a shop that has been
  // active since. activityTier() buckets at 30 and 90 days; walking the date
  // backwards would drop a live shop into 'dormant' and into a win-back
  // campaign it has no business receiving.
  const updates = pendingActivityUpdates(
    [biz('a', '2026-08-01T08:00:00Z')],
    { a: '2026-09-03' });
  assert.deepEqual(updates, []);
});

test('a shop with no stored day at all is stamped', () => {
  const updates = pendingActivityUpdates(
    [biz('a', '2026-09-03T08:00:00Z')],
    { a: null });
  assert.deepEqual(updates, [{ id: 'a', last_shop_activity_date: '2026-09-03' }]);
});

test('several shops are rolled up independently', () => {
  const updates = pendingActivityUpdates([
    biz('a', '2026-09-03T08:00:00Z'),
    biz('b', '2026-09-02T08:00:00Z'),
    biz('c', '2026-09-01T08:00:00Z'),
  ], { a: '2026-09-03', b: '2026-08-30', c: null });
  assert.deepEqual(updates, [
    { id: 'b', last_shop_activity_date: '2026-09-02' },
    { id: 'c', last_shop_activity_date: '2026-09-01' },
  ]);
});

test('unusable rows are skipped rather than stamping a bad date', () => {
  const updates = pendingActivityUpdates([
    biz(null, '2026-09-03T08:00:00Z'),
    biz('a', 'not-a-date'),
    biz('b', null),
  ], {});
  assert.deepEqual(updates, []);
});
