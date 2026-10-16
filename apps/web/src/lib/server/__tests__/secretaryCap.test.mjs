/**
 * The Free Secretary cap is "100 replies a month". It used to bump on every
 * incoming business message, including strangers MiniMe never answers
 * (ask_first) and everything in ghost mode: one shop hit 255/100 from 45
 * customer messages. It must bump only right before MiniMe answers.
 * Source-text test: the route can't be imported outside the Next bundler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../../../app/api/agent-bot/webhook/route.js', import.meta.url), 'utf8');
const start = route.indexOf('const secretaryCapReached = async');
const section = route.slice(start, route.indexOf('// ── 3. Callback query'));

test('the counter is bumped only inside secretaryCapReached', () => {
  assert.ok(start > 0);
  assert.equal(route.split("rpc('secretary_reply_bump'").length - 1, 1);
  const helper = section.slice(0, section.indexOf('const capped'));
  assert.match(helper, /rpc\('secretary_reply_bump'/);
});

test('every Secretary reply is preceded by the cap check, and nothing else is', () => {
  const replies = [...section.matchAll(/await handleTenantUpdate\(business, AGENT_TOKEN, update\)/g)];
  const checks = [...section.matchAll(/if \(await secretaryCapReached\(\)\) return capped\(\);/g)];
  assert.equal(replies.length, 3, 'personal contact, auto-mode stranger, known customer');
  assert.equal(checks.length, replies.length);
  for (const r of replies) {
    const before = section.slice(0, r.index);
    assert.ok(before.lastIndexOf('secretaryCapReached()') > before.lastIndexOf('handleTenantUpdate('),
      'each reply has its own check after the previous reply');
  }
});

test('ghost mode and ask_first strangers never touch the counter', () => {
  const ghost = section.slice(section.indexOf("=== 'ghost') {"), section.indexOf('if (contactEntry)'));
  assert.doesNotMatch(ghost, /secretaryCapReached/);
  const askFirst = section.slice(section.indexOf('// ASK_FIRST (default)'), section.indexOf('// Known customer'));
  assert.doesNotMatch(askFirst, /secretaryCapReached/);
});
