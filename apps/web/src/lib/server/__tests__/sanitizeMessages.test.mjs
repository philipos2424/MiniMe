/**
 * History truncation direction.
 *
 * sanitizeMessages caps how much chat history reaches a prompt. It used to walk
 * forwards and stop at the budget, which kept the OLDEST turns and dropped the
 * newest — so a long conversation showed the model how the chat opened and hid
 * what the customer had just said. That is the worst possible truncation for an
 * assistant being asked to follow the thread, and it got easier to hit once both
 * reply paths started fetching deeper history.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMessages } from '../sanitize.js';

const msg = (n, len = 100) => ({
  id: `m${n}`,
  direction: n % 2 ? 'outbound' : 'inbound',
  content: `${n}:` + 'x'.repeat(len),
});

test('over budget, the newest turns survive and the oldest are dropped', () => {
  const messages = Array.from({ length: 20 }, (_, i) => msg(i, 100));
  const out = sanitizeMessages(messages, { maxPerMessage: 800, maxTotal: 500 });

  assert.ok(out.length > 0 && out.length < 20, 'some turns must be dropped');
  assert.equal(out[out.length - 1].id, 'm19',
    'the message nearest the question must always be kept');
  assert.ok(!out.some(m => m.id === 'm0'),
    'the oldest turns are the ones the rolling summary stands in for');
});

test('the surviving turns stay in chronological order', () => {
  const messages = Array.from({ length: 10 }, (_, i) => msg(i, 100));
  const out = sanitizeMessages(messages, { maxPerMessage: 800, maxTotal: 400 });
  const ids = out.map(m => Number(m.id.slice(1)));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b),
    'a reversed transcript would read as the conversation running backwards');
});

test('under budget, everything is kept, in order', () => {
  const messages = Array.from({ length: 5 }, (_, i) => msg(i, 10));
  const out = sanitizeMessages(messages, { maxPerMessage: 800, maxTotal: 10000 });
  assert.equal(out.length, 5);
  assert.deepEqual(out.map(m => m.id), ['m0', 'm1', 'm2', 'm3', 'm4']);
});

test('per-message cap still applies, and other fields survive', () => {
  const out = sanitizeMessages([msg(1, 5000)], { maxPerMessage: 100, maxTotal: 10000 });
  assert.ok(out[0].content.length <= 100 + 20, 'long messages are still capped');
  assert.equal(out[0].direction, 'outbound');
  assert.equal(out[0].id, 'm1');
});

test('empty and malformed input never throws', () => {
  assert.deepEqual(sanitizeMessages([]), []);
  assert.deepEqual(sanitizeMessages(null), []);
  assert.equal(sanitizeMessages([{ direction: 'inbound' }])[0].content, '');
});
