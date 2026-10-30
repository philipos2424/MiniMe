import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { modeExplainer, connectionCanReply, connectedText, waitingCount } from '../secretaryCopy.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = here.slice(0, here.indexOf('apps'));

test('default mode is described as holding replies, not "automatic"', () => {
  const t = connectedText({ mode: 'ask_first' });
  assert.match(t, /DON'T reply yet/);
  assert.doesNotMatch(t, /automatically/);
  assert.match(t, /reply to this message/);
  assert.match(t, /Settings → Secretary Mode/);
});

test('every mode has its own sentence', () => {
  const seen = new Set(['ask_first', 'smart', 'auto', 'ghost'].map(modeExplainer));
  assert.equal(seen.size, 4);
  assert.equal(modeExplainer(undefined), modeExplainer('ask_first'));
});

test('missing reply permission is called out with the fix', () => {
  assert.equal(connectionCanReply({ rights: { can_reply: false } }), false);
  assert.equal(connectionCanReply({ can_reply: false }), false);
  assert.equal(connectionCanReply({ rights: { can_reply: true }, can_reply: false }), true);
  assert.equal(connectionCanReply({}), true);
  assert.match(connectedText({ canReply: false }), /Reply to messages/);
  assert.doesNotMatch(connectedText({ canReply: true }), /can't reply yet/);
});

test('waitingCount uses the prune function when given', () => {
  assert.equal(waitingCount({ a: {}, b: {} }), 2);
  assert.equal(waitingCount({ a: {}, b: {} }, () => ({ a: {} })), 1);
  assert.equal(waitingCount(null), 0);
});

test('connect handler uses the new copy; page shows status and hides steps once connected', () => {
  const hook = readFileSync(`${root}apps/web/src/app/api/agent-bot/webhook/route.js`, 'utf8');
  assert.match(hook, /connectedText\(\{/);
  assert.match(hook, /connectionCanReply\(conn\)/);
  const api = readFileSync(`${root}apps/web/src/app/api/settings/secretary/route.js`, 'utf8');
  assert.match(api, /connected: !!business\?\.telegram_biz_conn_id/);
  const page = readFileSync(`${root}apps/web/src/app/(dashboard)/settings/modes/page.js`, 'utf8');
  assert.match(page, /connected !== true && <div style=\{card\}>/);
  assert.match(page, /waiting<\/strong>|people are/);
});
