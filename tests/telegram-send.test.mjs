/**
 * Run: node --test tests/telegram-send.test.mjs
 * Guards the flood-safe Telegram sender: 429 retry_after backoff, blocked-user
 * classification, and the consecutive-flood-wait circuit breaker.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramMessage, floodBreaker } from '../apps/web/src/lib/server/telegram-send.mjs';

function fakeFetch(responses) {
  let i = 0;
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = responses[Math.min(i++, responses.length - 1)];
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  return { impl, calls };
}

const noSleep = () => {
  const waits = [];
  return { sleep: async ms => { waits.push(ms); }, waits };
};

test('successful send returns ok', async () => {
  const f = fakeFetch([{ status: 200, body: { ok: true } }]);
  const r = await sendTelegramMessage('tok', { chat_id: 1, text: 'hi' }, { fetchImpl: f.impl });
  assert.equal(r.ok, true);
  assert.equal(r.blocked, false);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /bottok\/sendMessage$/);
});

test('429 honors retry_after then succeeds', async () => {
  const f = fakeFetch([
    { status: 429, body: { ok: false, parameters: { retry_after: 7 } } },
    { status: 200, body: { ok: true } },
  ]);
  const s = noSleep();
  const r = await sendTelegramMessage('tok', { chat_id: 1, text: 'hi' }, { fetchImpl: f.impl, sleep: s.sleep });
  assert.equal(r.ok, true);
  assert.equal(r.retryAfterHit, true);
  assert.deepEqual(s.waits, [7000]);
  assert.equal(f.calls.length, 2);
});

test('retry_after is capped at 60s', async () => {
  const f = fakeFetch([
    { status: 429, body: { ok: false, parameters: { retry_after: 900 } } },
    { status: 200, body: { ok: true } },
  ]);
  const s = noSleep();
  await sendTelegramMessage('tok', { chat_id: 1 }, { fetchImpl: f.impl, sleep: s.sleep });
  assert.deepEqual(s.waits, [60000]);
});

test('second consecutive 429 gives up (no infinite retries)', async () => {
  const f = fakeFetch([
    { status: 429, body: { ok: false, parameters: { retry_after: 1 } } },
    { status: 429, body: { ok: false, parameters: { retry_after: 1 } } },
  ]);
  const s = noSleep();
  const r = await sendTelegramMessage('tok', { chat_id: 1 }, { fetchImpl: f.impl, sleep: s.sleep });
  assert.equal(r.ok, false);
  assert.equal(r.status, 429);
  assert.equal(r.retryAfterHit, true);
  assert.equal(f.calls.length, 2);
});

test('403 blocked-by-user is classified, not retried', async () => {
  const f = fakeFetch([{ status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } }]);
  const r = await sendTelegramMessage('tok', { chat_id: 1 }, { fetchImpl: f.impl });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.equal(f.calls.length, 1);
});

test('400 chat not found also counts as blocked (unreachable forever)', async () => {
  const f = fakeFetch([{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
  const r = await sendTelegramMessage('tok', { chat_id: 1 }, { fetchImpl: f.impl });
  assert.equal(r.blocked, true);
});

test('network error returns status 0, not thrown', async () => {
  const r = await sendTelegramMessage('tok', { chat_id: 1 }, { fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.equal(r.blocked, false);
});

test('floodBreaker trips after 3 consecutive 429s and resets on success', () => {
  const b = floodBreaker(3);
  b.hit429(); b.hit429();
  assert.equal(b.tripped, false);
  b.okSend();
  b.hit429(); b.hit429(); b.hit429();
  assert.equal(b.tripped, true);
});
