import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientSendResult, conversationPatchAfterSend } from '../brainDelivery.mjs';

const NOW = '2026-10-29T07:00:00.000Z';

// The brain was told ok:true for sends Telegram rejected, so it sent a second
// message into the same dead chat (median two failures per conversation).
test('a rejected send tells the model it failed and not to retry', () => {
  const r = clientSendResult({ delivered: false, error: 'Bad Request: chat not found' });
  assert.equal(r.ok, false);
  assert.match(r.error, /chat not found/);
  assert.match(r.error, /Do not send it again/);
});

test('a delivered send is ok, with a note when links were stripped', () => {
  assert.deepEqual(clientSendResult({ delivered: true }), { ok: true });
  const r = clientSendResult({ delivered: true, removed: ['https://example.com/x'] });
  assert.equal(r.ok, true);
  assert.match(r.note, /example\.com\/x/);
});

test('a failed reply to a waiting customer flags the conversation for the owner', () => {
  assert.deepEqual(conversationPatchAfterSend({ delivered: false, nowIso: NOW }), {
    requires_owner: true, last_ai_action: 'send_failed', last_message_at: NOW,
  });
});

// 225 conversations showed "send_failed" — nearly all were daily follow-ups to
// cold leads, not customers waiting on an answer.
test('a failed proactive follow-up leaves the conversation untouched', () => {
  assert.equal(conversationPatchAfterSend({ delivered: false, proactive: true, nowIso: NOW }), null);
});

test('a delivered proactive follow-up still records the send', () => {
  assert.deepEqual(conversationPatchAfterSend({ delivered: true, proactive: true, nowIso: NOW }), {
    requires_owner: false, last_ai_action: 'auto_sent', last_message_at: NOW,
  });
});

test('both brain send tools use the shared delivery outcome', () => {
  const src = readFileSync(new URL('../agentBrain.js', import.meta.url), 'utf8');
  assert.equal(src.match(/return clientSendResult\(/g)?.length, 2);
  assert.doesNotMatch(src, /last_ai_action: delivered \? 'auto_sent' : 'send_failed'/);
});

test('the follow-up cron skips Secretary chats and runs proactively', () => {
  const src = readFileSync(new URL('../../../app/api/cron/followups/route.js', import.meta.url), 'utf8');
  assert.match(src, /from\('biz_conn_chats'\)/);
  assert.match(src, /proactive: true/);
  assert.match(src, /followup_error/);
});
