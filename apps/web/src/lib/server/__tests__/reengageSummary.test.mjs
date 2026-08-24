import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSends, STAGE_LABELS, EXIT_LABELS } from '../reengage/summary.mjs';

const row = (over = {}) => ({
  stage: 'A1',
  variant: 'payoff',
  sent_at: new Date().toISOString(),
  replied_at: null,
  exit_reason: null,
  outcome: null,
  ...over,
});

test('empty input produces zeroed totals in canonical order', () => {
  const s = aggregateSends([]);
  assert.equal(s.totals.sent, 0);
  assert.equal(s.totals.replied, 0);
  assert.equal(s.totals.reply_rate, 0);
  assert.deepEqual(s.totals.outcomes, { completed: 0, advanced: 0, no_change: 0, pending: 0 });
  assert.deepEqual(s.by_stage.map(x => x.stage), ['A1', 'B1', 'B2', 'B3', 'B4', 'B5']);
  assert.deepEqual(s.by_variant.map(x => x.variant), ['demand', 'payoff']);
  assert.deepEqual(s.exit_reasons, []);
  assert.deepEqual(s.recent, []);
});

test('reply rate counts distinct sends with replied_at, rounded', () => {
  const rows = [
    row({ stage: 'A1', replied_at: '2026-08-01T10:00:00Z' }),
    row({ stage: 'A1', replied_at: '2026-08-01T11:00:00Z' }),
    row({ stage: 'A1' }),
  ];
  const s = aggregateSends(rows);
  assert.equal(s.totals.sent, 3);
  assert.equal(s.totals.replied, 2);
  assert.equal(s.totals.reply_rate, 67);
  const a1 = s.by_stage[0];
  assert.equal(a1.sent, 3);
  assert.equal(a1.replied, 2);
  assert.equal(a1.reply_rate, 67);
  // other stages untouched
  assert.equal(s.by_stage[1].sent, 0);
  assert.equal(s.by_stage[5].sent, 0);
});

test('stage rollup is per stage with its own reply rate and labels', () => {
  const rows = [
    row({ stage: 'A1', replied_at: '2026-08-01T10:00:00Z' }),
    row({ stage: 'B5', replied_at: '2026-08-01T11:00:00Z' }),
    row({ stage: 'B5', replied_at: '2026-08-01T12:00:00Z' }),
    row({ stage: 'B5' }),
    row({ stage: 'B3' }),
  ];
  const s = aggregateSends(rows);
  assert.equal(s.by_stage[0].sent, 1);
  assert.equal(s.by_stage[0].reply_rate, 100);
  assert.equal(s.by_stage[5].sent, 3);
  assert.equal(s.by_stage[5].replied, 2);
  assert.equal(s.by_stage[5].reply_rate, 67);
  assert.equal(s.by_stage[3].sent, 1);
  assert.equal(s.by_stage[3].reply_rate, 0);
  assert.equal(s.by_stage[0].label, STAGE_LABELS.A1);
  assert.equal(s.by_stage[5].label, STAGE_LABELS.B5);
});

test('outcome buckets default unknown to pending and split known values', () => {
  const rows = [
    row({ outcome: 'completed' }),
    row({ outcome: 'completed' }),
    row({ outcome: 'advanced' }),
    row({ outcome: 'no_change' }),
    row({}), // null outcome
    row({ outcome: undefined }),
  ];
  const s = aggregateSends(rows);
  assert.deepEqual(s.totals.outcomes, { completed: 2, advanced: 1, no_change: 1, pending: 2 });
});

test('variant split reports demand vs payoff arms', () => {
  const rows = [
    row({ variant: 'demand', replied_at: '2026-08-01T10:00:00Z' }),
    row({ variant: 'demand' }),
    row({ variant: 'payoff', replied_at: '2026-08-01T10:00:00Z' }),
    row({ variant: 'payoff', replied_at: '2026-08-01T11:00:00Z' }),
    row({ variant: 'payoff' }),
  ];
  const s = aggregateSends(rows);
  assert.deepEqual(s.by_variant, [
    { variant: 'demand', sent: 2, replied: 1, reply_rate: 50 },
    { variant: 'payoff', sent: 3, replied: 2, reply_rate: 67 },
  ]);
});

test('exit reasons count, label, and sort descending', () => {
  const rows = [
    row({ exit_reason: 'too_complicated' }),
    row({ exit_reason: 'too_complicated' }),
    row({ exit_reason: 'no_time' }),
    row({ exit_reason: 'unknown_reason' }),
    row({}),
  ];
  const s = aggregateSends(rows);
  assert.deepEqual(s.exit_reasons, [
    { reason: 'too_complicated', label: EXIT_LABELS.too_complicated, count: 2 },
    { reason: 'no_time', label: EXIT_LABELS.no_time, count: 1 },
    { reason: 'unknown_reason', label: 'unknown_reason', count: 1 },
  ]);
});

test('recent is newest-first and capped by recentCount', () => {
  const rows = [
    row({ sent_at: '2026-08-01T10:00:00Z' }),
    row({ sent_at: '2026-08-02T10:00:00Z' }),
    row({ sent_at: '2026-08-03T10:00:00Z' }),
  ];
  const s = aggregateSends(rows, { recentCount: 2 });
  assert.equal(s.recent.length, 2);
  assert.equal(s.recent[0].sent_at, '2026-08-03T10:00:00Z');
  assert.equal(s.recent[1].sent_at, '2026-08-02T10:00:00Z');
});

test('by_day buckets in EAT, splitting UTC days across midnight', () => {
  const dayMs = 86400000;
  const nowMs = Date.now();
  const eve = new Date(nowMs); eve.setUTCHours(20, 30, 0, 0); eve.setTime(eve.getTime() - 2 * dayMs);
  const late = new Date(eve.getTime() + 3600000); // 21:30 UTC, same UTC date
  const morning = new Date(nowMs); morning.setUTCHours(9, 0, 0, 0); morning.setTime(morning.getTime() - 5 * dayMs);

  const rows = [
    row({ sent_at: eve.toISOString() }), // 23:30 EAT — same UTC date
    row({ sent_at: late.toISOString() }), // 00:30 EAT — NEXT EAT day
    row({ sent_at: morning.toISOString() }), // 12:00 EAT
  ];
  const s = aggregateSends(rows, { days: 7 });
  assert.equal(s.by_day.length, 7);
  assert.equal(s.by_day.reduce((sum, d) => sum + d.sent, 0), 3);

  // Manual EAT keys (UTC+3, no DST): the 21:30Z send lands the day after 20:30Z.
  const eveKey = eve.toISOString().slice(0, 10);
  const lateKey = new Date(late.getTime() + 3 * 3600000).toISOString().slice(0, 10);
  const morningKey = morning.toISOString().slice(0, 10);
  assert.notEqual(lateKey, eveKey);
  const byKey = Object.fromEntries(s.by_day.map(d => [d.day, d.sent]));
  assert.equal(byKey[eveKey], 1);
  assert.equal(byKey[lateKey], 1);
  assert.equal(byKey[morningKey], 1);
});
