import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const webhook  = readFileSync(`${root}apps/web/src/app/api/agent-bot/webhook/route.js`, 'utf8');
const outcomes = readFileSync(`${root}apps/web/src/lib/server/reengage/outcomes.js`, 'utf8');
const route    = readFileSync(`${root}apps/web/src/app/api/cron/reengagement/route.js`, 'utf8');

test('a reply to a nudge is handled before the unknown-user brush-off', () => {
  const replyIdx   = webhook.indexOf('recentReengagementSend');
  const unknownIdx = webhook.indexOf('Unknown user');
  assert.ok(replyIdx > -1, 'no re-engagement reply branch');
  assert.ok(replyIdx < unknownIdx, 'the branch must run before the unknown-user fallback');
});

test('replying is recorded, so reply rate is measurable per variant', () => {
  assert.match(webhook, /replied_at/);
});

test('the exit-question chips are handled and their reason stored', () => {
  assert.match(webhook, /reengage_exit:/);
  assert.match(webhook, /exit_reason/);
});

test('outcomes are resolved by comparing stage now against stage at send time', () => {
  assert.match(outcomes, /detectStage/);
  assert.match(outcomes, /advanced/);
});

test('only unresolved sends old enough to judge are swept', () => {
  assert.match(outcomes, /outcome/);
  assert.match(outcomes, /is\(['"]outcome['"],\s*null\)/);
});

test('the cron actually runs the sweep, or attribution never resolves', () => {
  assert.match(route, /resolveOutcomes/);
});
