/**
 * Orders the AI creates (agentBrain create_order) reach the owner every time.
 * They used to reach the owner only if the model also called notify_owner.
 * The no-payment-method path is escalated after the turn (payment_setup_failed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const brain = read('../agentBrain.js');

test('the happy path notifies the owner after the customer gets pay buttons', () => {
  const happy = brain.slice(brain.indexOf('if (inlineButtons.length) {'), brain.indexOf('No payment method could be presented'));
  assert.ok(happy.indexOf("reply_markup: { inline_keyboard: inlineButtons }") < happy.indexOf('notifyOwnerNewOrder('));
  assert.match(happy, /owner_notified: true/);
});

test('the no-payment path is still escalated to the owner', () => {
  assert.match(brain, /state\.payment_setup_failed = \{ order_id: order\.id/);
  assert.match(brain, /if \(escalateFailures \|\| state\.payment_setup_failed\)/);
});

test('notifyOwnerNewOrder matches the checkout notice', async () => {
  const src = read('../orderPayments.js');
  const fnSrc = src.slice(src.indexOf('export async function notifyOwnerNewOrder'), src.indexOf('/**\n * Edit the owner'))
    .replace('export async function', 'async function');
  const sent = [];
  const fn = new Function('tg', `${fnSrc}\nreturn notifyOwnerNewOrder;`)((t, m, b) => { sent.push(b); return Promise.resolve({ ok: true }); });
  await fn({
    token: 'T', business: { owner_telegram_id: 9 }, customer: { id: 'c1', name: 'Abebe' },
    lines: '• 2 × Card = 1,500 ETB', total: 1500, currency: 'ETB',
    methods: { telebirr: true }, chapaUrl: null, ref: 'AB12CD34', extraLines: ['📍 Deliver to: Bole', ''],
  });
  assert.equal(sent[0].chat_id, 9);
  assert.match(sent[0].text, /New order — awaiting payment/);
  assert.match(sent[0].text, /Deliver to: Bole/);
  assert.match(sent[0].text, /offered Telebirr \(ref `AB12CD34`\)/);
  assert.equal(sent[0].reply_markup.inline_keyboard[0][0].callback_data, 'odm_c1');
});
