/**
 * 3b: owners are reminded about "I've paid" claims they haven't answered, with
 * the receipt attached. 3c: queued verify.et checks finish or time out to a
 * human instead of sitting in pending_review forever.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { queuedAtFromNotes, queuedVerificationAction, VERIFY_TIMEOUT_MS } from '../verifyEtDecision.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const now = new Date('2026-10-26T12:00:00.000Z');

test('queued time is read from the proof route\'s payment_notes stamp', () => {
  const notes = 'Awaiting verify.et — telebirr_manual — bank ref ABC123 — 2026-10-26T11:20:00.000Z';
  assert.equal(queuedAtFromNotes(notes).toISOString(), '2026-10-26T11:20:00.000Z');
  assert.equal(queuedAtFromNotes('no stamp'), null);
  // The proof step (now subscriptionProof.js, shared by the route and the bot) still writes that stamp.
  assert.match(read('../subscriptionProof.js'), /payment_notes: `Awaiting verify\.et — \$\{method\} — bank ref \$\{bankRef\} — \$\{new Date\(\)\.toISOString\(\)\}`/);
});

test('a finished verification is settled; a running one waits, then goes to manual review', () => {
  const queuedAt = new Date(now.getTime() - 10 * 60000);
  assert.equal(queuedVerificationAction({ result: { ok: true, state: 'verified' }, queuedAt, now }), 'settle');
  assert.equal(queuedVerificationAction({ result: { ok: true, state: 'failed' }, queuedAt, now }), 'settle');
  assert.equal(queuedVerificationAction({ result: { ok: true, state: 'queued' }, queuedAt, now }), 'wait');
  assert.equal(queuedVerificationAction({ result: { ok: false, state: 'error' }, queuedAt, now }), 'wait');
  const old = new Date(now.getTime() - VERIFY_TIMEOUT_MS);
  assert.equal(queuedVerificationAction({ result: { ok: true, state: 'queued' }, queuedAt: old, now }), 'manual_review');
  assert.equal(queuedVerificationAction({ result: { ok: true, state: 'pending' }, queuedAt: old, now }), 'manual_review');
  assert.equal(queuedVerificationAction({ result: { ok: true, state: 'queued' }, queuedAt: null, now }), 'manual_review');
});

test('fetchVerification finally has a caller, and manual review alerts the admin with buttons', () => {
  const pv = read('../paymentVerification.js');
  assert.match(pv, /await fetchVerification\(business\.verifyet_request_id\)/);
  assert.match(pv, /sub_approve_\$\{business\.id\}/);
  assert.match(pv, /verifyet_request_id: null,\s*\n\s*payment_notes: `verify\.et did not finish/);
});

test('shared-bot owners hear the verification result', () => {
  assert.match(read('../paymentVerification.js'), /: process\.env\.TELEGRAM_BOT_TOKEN;/);
});

test('cron runs both jobs and is scheduled', () => {
  const cron = read('../../../app/api/cron/payment-followups/route.js');
  assert.match(cron, /remindUnconfirmedPayments/);
  assert.match(cron, /settleQueuedVerifications/);
  assert.match(cron, /reminder: true/);
  const vercel = JSON.parse(read('../../../../vercel.json'));
  assert.ok(vercel.crons.filter(c => c.path === '/api/cron/payment-followups').length >= 1);
});

test('the claim records when it was made, and the owner message attaches the receipt', () => {
  const engine = read('../replyEngine.js');
  assert.match(engine, /payment_claimed_at: new Date\(\)\.toISOString\(\), payment_reminded_at: null/);
  const op = read('../orderPayments.js');
  assert.match(op, /tg\(token, 'sendPhoto', \{ chat_id: chatId, photo: receipt/);
  assert.match(op, /\.eq\('content_type', 'image'\)/);
});

test('a second Confirm (e.g. from the reminder) does not pay out twice', () => {
  const engine = read('../replyEngine.js');
  const confirm = engine.slice(engine.indexOf("if (data.startsWith('cbe_confirm_')) {\n      const orderId"));
  assert.match(confirm.slice(0, 800), /if \(order\.status === 'paid'\)/);
});
