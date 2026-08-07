/**
 * The send-tap upgrade nudge.
 *
 * This fires on a hot, repeated action (every "✅ Send" a Free owner taps), so
 * the failure mode is nagging someone dozens of times — which costs more trust
 * than the upgrade is worth. These tests pin the brakes.
 *
 * replyEngine.js can't be imported here (extensionless specifiers only the Next
 * bundler resolves), so this asserts against the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const engine = readFileSync(`${root}apps/web/src/lib/server/replyEngine.js`, 'utf8');
const migration = readFileSync(`${root}packages/db/migrations/037_draft_send_nudge.sql`, 'utf8');

const fn = engine.match(/async function maybeNudgeAfterSend[\s\S]*?\n\}/)[0];

test('paying and trial shops are never nudged', () => {
  assert.match(fn, /if \(isProServer\(business\)\) return;/);
});

test('nothing is asked until the owner has actually felt the repetition', () => {
  // Asking on tap 2 is asking before there is a problem to solve.
  const first = Number(engine.match(/FIRST_NUDGE_AT\s*=\s*(\d+)/)[1]);
  assert.ok(first >= 10, `first nudge at ${first} taps is too eager`);
});

test('two independent brakes: a count interval AND a time cooldown', () => {
  // The count alone isn't enough — a very busy shop would clear it repeatedly
  // in one week. The cooldown alone isn't enough either, for a quiet shop.
  const every = Number(engine.match(/NUDGE_EVERY\s*=\s*(\d+)/)[1]);
  const cooldown = Number(engine.match(/NUDGE_COOLDOWN_DAYS\s*=\s*(\d+)/)[1]);
  assert.ok(every >= 25, `nudging every ${every} sends is too frequent`);
  assert.ok(cooldown >= 7, `a ${cooldown}-day cooldown is too short`);

  assert.match(fn, /% NUDGE_EVERY === 0/);
  assert.match(fn, /NUDGE_COOLDOWN_DAYS \* 86400000\) return;/);
});

test('the cooldown is recorded BEFORE the message is sent', () => {
  // Otherwise a send failure leaves the cooldown unset and the next tap
  // re-nudges — the exact loop that makes a prompt feel like harassment.
  const stampAt = fn.indexOf('draft_nudge_last_at');
  const sendAt = fn.indexOf("tg(token, 'sendMessage'");
  assert.ok(stampAt > 0 && sendAt > 0 && stampAt < sendAt, 'cooldown written after send');
});

test('the nudge can never block, delay, or break the customer reply', () => {
  // It is fired after the send has already happened, unawaited, and swallows
  // its own errors at every step.
  assert.match(engine, /maybeNudgeAfterSend\(token, business, chatId\)\.catch\(\(\) => \{\}\)/);
  // Search for the CALL (which carries .catch), not the function definition —
  // the definition appears earlier in the file and would match a bare name.
  const call = engine.indexOf('maybeNudgeAfterSend(token, business, chatId).catch');
  const sent = engine.indexOf("await editMsg(token, chatId, msgId, `✅ Sent!");
  assert.ok(sent > 0 && call > sent, 'nudge runs before the send is confirmed');
  assert.match(fn, /if \(error \|\| !Number\.isFinite\(Number\(count\)\)\) return;/);
});

test('the counter is bumped atomically, not read-modify-written', () => {
  // A busy shop approving several drafts at once would otherwise undercount.
  assert.match(fn, /rpc\('draft_approved_bump'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION draft_approved_bump/);
  assert.match(migration, /RETURNING drafts_approved_count INTO new_count/);
});

test('the nudge states the real count and a real price', () => {
  assert.match(fn, /\$\{n\}\* replies/);
  assert.match(fn, /PRO_PRICE_ETB\.toLocaleString/);
  // Risk reversal travels with the ask.
  assert.match(fn, /cancel anytime/);
});
