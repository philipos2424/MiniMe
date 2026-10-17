/**
 * The fast path answered most chats (31 of 32 AI replies on 2026-10-17) but
 * recorded status 'sent' without checking Telegram's reply, so a rejected send
 * looked delivered. It must follow the main auto-send rule. Source-text test:
 * replyEngine can't be imported without the full runtime.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../replyEngine.js', import.meta.url), 'utf8');
const start = src.indexOf('const fastRaw = fastCompletion');
const block = src.slice(start, src.indexOf('maybeAttachProductPhoto', start));

test('fast path keeps the Telegram send result', () => {
  assert.match(block, /const fastSend = await tg\(token, 'sendMessage'/);
  assert.match(block, /const fastDelivered = fastSend\?\.ok === true/);
});

test('fast path records failed sends as failed, not sent', () => {
  assert.match(block, /status: fastDelivered \? 'sent' : 'failed'/);
  assert.match(block, /sent_at: fastDelivered \? new Date\(\)\.toISOString\(\) : null/);
  assert.doesNotMatch(block, /content_type: 'text', status: 'sent'/);
});

test('a failed fast-path send flags the conversation for the owner', () => {
  assert.match(block, /requires_owner: true/);
  assert.match(block, /touchConversation\(conversation\.id, fastDelivered \? 'auto_sent' : 'drafted'\)/);
});
