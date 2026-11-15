import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CRON_JOBS, SUB_DAILY_JOBS, cronMatches, tickFor, pathsDueAt, TICK_MINUTES } from '../../cronSchedule.mjs';

const at = iso => new Date(iso);
const key = j => `${j.path} ${j.schedule}`;

test('the Netlify cron table is the same as vercel.json', () => {
  const vercel = JSON.parse(readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(CRON_JOBS.map(key).sort(), vercel.crons.map(key).sort());
});

test('every schedule lands on the dispatcher tick', () => {
  for (const j of [...CRON_JOBS, ...SUB_DAILY_JOBS]) {
    const minute = j.schedule.split(/\s+/)[0];
    assert.ok(['0', '30'].includes(minute), `${j.path} runs at minute ${minute}, which a ${TICK_MINUTES}-minute tick never hits`);
  }
});

test('every job runs at least once in a week of ticks', () => {
  const ran = new Set();
  for (let t = Date.UTC(2026, 10, 9); t < Date.UTC(2026, 10, 16); t += TICK_MINUTES * 60_000) {
    for (const p of pathsDueAt(new Date(t))) ran.add(p);
  }
  for (const j of [...CRON_JOBS, ...SUB_DAILY_JOBS]) assert.ok(ran.has(j.path), `${j.path} never ran`);
});

test('cronMatches: plain daily time', () => {
  assert.equal(cronMatches('0 9 * * *', at('2026-11-14T09:00:00Z')), true);
  assert.equal(cronMatches('0 9 * * *', at('2026-11-14T09:30:00Z')), false);
  assert.equal(cronMatches('30 16 * * *', at('2026-11-14T16:30:00Z')), true);
});

test('cronMatches: day of week, Sunday as 0 or 7', () => {
  // 2026-11-16 is a Monday, 2026-11-15 a Sunday.
  assert.equal(cronMatches('0 5 * * 1', at('2026-11-16T05:00:00Z')), true);
  assert.equal(cronMatches('0 5 * * 1', at('2026-11-15T05:00:00Z')), false);
  assert.equal(cronMatches('0 3 * * 0', at('2026-11-15T03:00:00Z')), true);
  assert.equal(cronMatches('0 3 * * 7', at('2026-11-15T03:00:00Z')), true);
});

test('cronMatches: steps, ranges and lists', () => {
  assert.equal(cronMatches('0 */2 * * *', at('2026-11-14T04:00:00Z')), true);
  assert.equal(cronMatches('0 */2 * * *', at('2026-11-14T05:00:00Z')), false);
  assert.equal(cronMatches('0 * * * *', at('2026-11-14T05:00:00Z')), true);
  assert.equal(cronMatches('0 9-17 * * 1-5', at('2026-11-16T12:00:00Z')), true);
  assert.equal(cronMatches('0 9-17 * * 1-5', at('2026-11-15T12:00:00Z')), false);
  assert.equal(cronMatches('0,30 6 * * *', at('2026-11-14T06:30:00Z')), true);
});

test('cronMatches: rejects what it cannot read', () => {
  assert.equal(cronMatches('0 9 * *', at('2026-11-14T09:00:00Z')), false);
  assert.equal(cronMatches('@daily', at('2026-11-14T00:00:00Z')), false);
  assert.equal(cronMatches('x 9 * * *', at('2026-11-14T09:00:00Z')), false);
});

test('tickFor snaps an early or late wake-up to the half hour', () => {
  assert.equal(tickFor(at('2026-11-14T06:00:03Z')).toISOString(), '2026-11-14T06:00:00.000Z');
  assert.equal(tickFor(at('2026-11-14T05:59:58Z')).toISOString(), '2026-11-14T06:00:00.000Z');
  assert.equal(tickFor(at('2026-11-14T06:32:10Z')).toISOString(), '2026-11-14T06:30:00.000Z');
});

test('pathsDueAt: one call per route even when schedules coincide', () => {
  const due = pathsDueAt(at('2026-11-16T06:00:00Z'));
  assert.equal(new Set(due).size, due.length);
  for (const p of ['/api/cron/followups', '/api/cron/agent-tasks', '/api/cron/scheduled-messages', '/api/cron/weekly-reengagement-digest', '/api/cron/delegation', '/api/cron/pulse-alert']) {
    assert.ok(due.includes(p), `${p} should be due Monday 06:00 UTC`);
  }
  assert.deepEqual(pathsDueAt(at('2026-11-14T13:30:00Z')), []);
  assert.deepEqual(pathsDueAt(at('2026-11-14T13:00:00Z')), ['/api/cron/delegation']);
});
