import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSend, pickVariant, MAX_SENDS, SEND_SCHEDULE_DAYS } from '../reengage/eligibility.mjs';

const DAY = 86400000;
const now = Date.parse('2026-08-08T17:00:00Z');
const base = { stage: 'B4', sends: [], optedOut: false, isAdminUser: false, now };

test('someone who stalled an hour ago is not nudged mid-signup', () => {
  const d = decideSend({ ...base, stalledAt: new Date(now - 3600_000).toISOString() });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'too_new');
});

test('the first send goes out once day 1 has passed', () => {
  const d = decideSend({ ...base, stalledAt: new Date(now - 2 * DAY).toISOString() });
  assert.equal(d.send, true);
  assert.equal(d.sendIndex, 0);
  assert.equal(d.isFinal, false);
});

test('opting out silences everything, however long they have stalled', () => {
  const d = decideSend({ ...base, stalledAt: new Date(now - 30 * DAY).toISOString(), optedOut: true });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'opted_out');
});

test('platform admins are never nudged', () => {
  const d = decideSend({ ...base, stalledAt: new Date(now - 30 * DAY).toISOString(), isAdminUser: true });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'suppressed_admin');
});

test('a second send waits for its scheduled day, not just for the cooldown', () => {
  const stalledAt = new Date(now - 2 * DAY).toISOString();
  const sends = [{ sent_at: new Date(now - 1 * DAY).toISOString() }];
  const d = decideSend({ ...base, stalledAt, sends });
  assert.equal(d.send, false, 'day 3 has not arrived yet');
});

test('the second send goes out on day 3', () => {
  const stalledAt = new Date(now - 4 * DAY).toISOString();
  const sends = [{ sent_at: new Date(now - 3 * DAY).toISOString() }];
  const d = decideSend({ ...base, stalledAt, sends });
  assert.equal(d.send, true);
  assert.equal(d.sendIndex, 1);
});

test('the third send is the final one and is flagged as such', () => {
  const stalledAt = new Date(now - 11 * DAY).toISOString();
  const sends = [
    { sent_at: new Date(now - 10 * DAY).toISOString() },
    { sent_at: new Date(now - 8 * DAY).toISOString() },
  ];
  const d = decideSend({ ...base, stalledAt, sends });
  assert.equal(d.send, true);
  assert.equal(d.sendIndex, 2);
  assert.equal(d.isFinal, true);
});

test('after three sends we stop permanently', () => {
  const stalledAt = new Date(now - 90 * DAY).toISOString();
  const sends = [1, 2, 3].map(i => ({ sent_at: new Date(now - (20 + i) * DAY).toISOString() }));
  const d = decideSend({ ...base, stalledAt, sends });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'max_sends');
  assert.equal(sends.length, MAX_SENDS);
});

test('a person with no stage is never a candidate', () => {
  const d = decideSend({ ...base, stage: null, stalledAt: new Date(now - 30 * DAY).toISOString() });
  assert.equal(d.send, false);
  assert.equal(d.reason, 'no_stage');
});

test('variant assignment is stable across sends for the same person', () => {
  assert.equal(pickVariant(12345, 'B4'), pickVariant(12345, 'B4'));
});

test('variant assignment splits the population across both arms', () => {
  const arms = new Set();
  for (let id = 1; id <= 200; id++) arms.add(pickVariant(id, 'B4'));
  assert.deepEqual([...arms].sort(), ['demand', 'payoff']);
});

test('the schedule is the documented day 1 / 3 / 10', () => {
  assert.deepEqual(SEND_SCHEDULE_DAYS, [1, 3, 10]);
});
