import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendScheduledFollowUp } from '../scheduledFollowUp.mjs';
import { observeDelivery } from '../deliveryOutcome.mjs';

const NOW = Date.parse('2026-09-22T12:00:00Z');
function fixture({ response = { ok: true, result: { message_id: 42 } }, sendError, claimError, saveError, ownerError } = {}) {
  const task = {
    id: 'task-1', business_id: 'business-1', status: 'pending', scheduled_at: '2026-09-22T10:00:00Z',
    payload: { target: 'Phili', recipient_tg_id: 100, customer_id: 'customer-1', interval: 'daily', attempt: 2, last_sent_at: '2026-09-21T12:00:00Z' },
  };
  let stored = structuredClone(task);
  const sends = [], messages = [];
  let updates = 0;
  const sb = { from(table) {
    let patch, filters = [], insertion;
    const q = {
      update(value) { patch = value; return q; },
      insert(value) { insertion = value; return q; },
      eq(key, value) { filters.push([key, value]); return q; },
      select() { return q; }, order() { return q; }, limit() { return q; },
      maybeSingle() { return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (table === 'agent_tasks' && patch) {
            updates++;
            if ((updates === 1 && claimError) || (updates > 1 && saveError)) return { error: { message: 'database unavailable' } };
            if (!filters.every(([key, value]) => stored[key] === value)) return { data: null };
            stored = { ...stored, ...structuredClone(patch) };
            return { data: { id: stored.id }, error: null };
          }
          if (table === 'conversations') return { data: { id: 'conversation-1' } };
          if (table === 'messages') messages.push(insertion);
          return { data: null, error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  } };
  const send = async body => {
    sends.push(body);
    if (body.chat_id === 999) {
      if (ownerError) throw new Error('owner notification disconnected');
      return { ok: true };
    }
    assert.equal(stored.status, 'in_progress', 'send must have a durable claim first');
    if (sendError) throw new Error('connection lost');
    return typeof response === 'function' ? response() : response;
  };
  return {
    task, sends, messages, stored: () => stored,
    run: () => sendScheduledFollowUp({ sb, send, task, business: { owner_private_chat_id: 999, telegram_biz_conn_id: 'conn-1' }, draft: 'Checking in', now: () => NOW, timeoutMs: 10 }),
  };
}

test('confirmed send records one successful attempt, receipt, message and next run', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { ok: true, auto_sent: true, delivery_outcome: 'sent' });
  const saved = f.stored();
  assert.equal(saved.status, 'pending');
  assert.equal(saved.payload.attempt, 3);
  assert.equal(saved.payload.last_sent_at, new Date(NOW).toISOString());
  assert.equal(saved.payload.delivery_attempt.message_id, 42);
  assert.equal(saved.scheduled_at, new Date(NOW + 86400000).toISOString());
  assert.equal(f.messages[0].status, 'sent');
  assert.equal(f.sends[0].business_connection_id, 'conn-1');
});

test('provider rejection fails visibly without fabricating a sent attempt', async () => {
  const f = fixture({ response: { ok: false, description: 'Forbidden: bot was blocked' } });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.auto_sent, false);
  assert.equal(result.delivery_outcome, 'rejected');
  assert.equal(f.stored().status, 'failed');
  assert.equal(f.stored().payload.attempt, 2);
  assert.equal(f.stored().payload.last_sent_at, f.task.payload.last_sent_at);
  assert.equal(f.messages.length, 0);
  assert.match(f.sends[1].text, /was rejected/);
  await f.run();
  assert.equal(f.sends.filter(s => s.chat_id === 100).length, 1, 'stale cron snapshot cannot resend');
});

for (const [label, options] of [
  ['network error', { sendError: true }],
  ['malformed response', { response: {} }],
  ['timeout', { response: () => new Promise(() => {}) }],
]) {
  test(`${label} blocks automatic retries without claiming success`, async () => {
    const f = fixture(options);
    const result = await f.run();
    assert.equal(result.ok, false);
    assert.equal(result.auto_sent, false);
    assert.equal(result.delivery_outcome, 'unknown');
    assert.equal(f.stored().status, 'blocked');
    assert.equal(f.stored().payload.attempt, 2);
    assert.equal(f.stored().payload.last_sent_at, f.task.payload.last_sent_at);
    assert.equal(f.messages.length, 0);
    assert.match(f.sends[1].text, /couldn't confirm/);
    await f.run();
    assert.equal(f.sends.filter(s => s.chat_id === 100).length, 1);
  });
}

test('two concurrent workers send a scheduled occurrence only once', async () => {
  const f = fixture();
  const results = await Promise.all([f.run(), f.run()]);
  assert.equal(results.filter(r => r.auto_sent).length, 1);
  assert.equal(f.sends.filter(s => s.chat_id === 100).length, 1);
});

test('an old cron snapshot cannot send the next re-armed occurrence early', async () => {
  const f = fixture();
  await f.run();
  assert.equal((await f.run()).skipped, 'already_claimed');
  assert.equal(f.sends.filter(s => s.chat_id === 100).length, 1);
});

test('claim failure prevents every external send', async () => {
  const f = fixture({ claimError: true });
  assert.equal((await f.run()).error, 'claim_failed');
  assert.equal(f.sends.length, 0);
});

test('a failed receipt save retains the claim and never duplicates a confirmed send', async () => {
  const f = fixture({ saveError: true });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.auto_sent, true, 'the provider did confirm this send');
  assert.equal(result.error, 'outcome_save_failed');
  assert.equal(f.stored().status, 'in_progress');
  await f.run();
  assert.equal(f.sends.filter(s => s.chat_id === 100).length, 1);
});

test('owner notification failure does not undo the successful-send receipt', async () => {
  const f = fixture({ ownerError: true });
  assert.equal((await f.run()).ok, true);
  assert.equal(f.stored().payload.attempt, 3);
});

test('a late provider response cannot turn an already unknown outcome into success', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const result = await observeDelivery(() => pending, { timeoutMs: 2 });
  assert.equal(result.outcome, 'unknown');
  finish({ ok: true, result: { message_id: 7 } });
  await pending;
  assert.equal(result.ok, false);
});
