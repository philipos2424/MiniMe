import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { replyParams, sendErrorRecord, skipColdFollowUp } from '../sendFailure.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');

test('replies still send when the customer message is gone', () => {
  assert.deepEqual(replyParams(42), { reply_parameters: { message_id: 42, allow_sending_without_reply: true } });
  assert.deepEqual(replyParams(null), {});
});

test('send errors are stored short, with where they happened', () => {
  const r = sendErrorRecord({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, { path: 'fast', at: new Date('2026-10-30T00:00:00Z') });
  assert.deepEqual(r, { at: '2026-10-30T00:00:00.000Z', path: 'fast', code: 403, description: 'Forbidden: bot was blocked by the user' });
  assert.equal(sendErrorRecord(null).description, 'no response');
});

test('cold follow-ups skip Secretary chats', () => {
  assert.equal(skipColdFollowUp({ isSecretaryChat: true }), true);
  assert.equal(skipColdFollowUp({ isSecretaryChat: false }), false);
});

test('no customer reply uses the bare reply_to_message_id any more', () => {
  assert.doesNotMatch(read('../agentBrain.js'), /text: finalText, reply_to_message_id: messageId/);
  const eng = read('../replyEngine.js');
  assert.doesNotMatch(eng, /text: fastReply, reply_to_message_id: messageId/);
  assert.doesNotMatch(eng, /text: draft, reply_to_message_id: messageId/);
});

test('a refused fast reply goes to the owner as a draft, with the reason', () => {
  const eng = read('../replyEngine.js');
  assert.match(eng, /!fastDelivered && fastSaved\?\.id\) \{\s*await notifyOwnerDraft\(/);
  assert.match(eng, /last_send_error: sendErrorRecord\(fastSend, \{ path: 'fast' \}\)/);
  assert.match(eng, /Telegram didn't deliver this reply/);
});

test('a refused background follow-up does not flag the chat', () => {
  const brain = read('../agentBrain.js');
  assert.equal((brain.match(/if \(delivered \|\| lane !== 'background'\)/g) || []).length, 2);
  assert.match(brain, /makeTools\(\{[^}]*lane \}\)/);
});

test('follow-up cron checks for a Secretary chat; shared bot ignores group chatter', () => {
  assert.match(read('../../../app/api/cron/followups/route.js'), /skipColdFollowUp\(\{ isSecretaryChat: !!secChat \}\)/);
  assert.match(read('../../../app/api/agent-bot/webhook/route.js'), /msg\.chat\.type !== 'private'/);
});
