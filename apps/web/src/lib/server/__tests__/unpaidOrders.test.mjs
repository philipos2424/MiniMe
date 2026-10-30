import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  awaitingManualPayment, unpaidFollowUpDue, customerPaymentNudgeText, ownerUnpaidText,
} from '../customerPayments.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');
const H = 3600 * 1000;
const now = new Date('2026-10-30T12:00:00Z');
const order = (over = {}) => ({
  id: 'abcd1234-0000', status: 'pending_payment', payment_method: 'telebirr_manual',
  total: 1500, currency: 'ETB', items: [{ quantity: 2, name: 'Coffee 1kg' }],
  created_at: new Date(now.getTime() - 4 * H).toISOString(), meta: {}, ...over,
});

test('only unclaimed, manual, recent, unpaid orders are followed up', () => {
  assert.ok(awaitingManualPayment(order(), now));
  assert.equal(awaitingManualPayment(order({ status: 'paid' }), now), false);
  assert.equal(awaitingManualPayment(order({ payment_method: 'chapa' }), now), false);
  assert.equal(awaitingManualPayment(order({ meta: { payment_claimed_at: 'x' } }), now), false);
  assert.equal(awaitingManualPayment(order({ created_at: new Date(now - 80 * H).toISOString() }), now), false);
  assert.equal(awaitingManualPayment(order({ meta: null }), now), true);
});

test('customer is reminded after 3h, once', () => {
  assert.equal(unpaidFollowUpDue(order({ created_at: new Date(now - 2 * H).toISOString() }), now), null);
  assert.equal(unpaidFollowUpDue(order(), now), 'customer');
  assert.equal(unpaidFollowUpDue(order({ meta: { customer_nudged_at: 'x' } }), now), null);
});

test('owner hears after a day, only once the customer was reminded', () => {
  const old = new Date(now - 26 * H).toISOString();
  assert.equal(unpaidFollowUpDue(order({ created_at: old }), now), 'customer');
  assert.equal(unpaidFollowUpDue(order({ created_at: old, meta: { customer_nudged_at: 'x' } }), now), 'owner');
  assert.equal(unpaidFollowUpDue(order({ created_at: old, meta: { customer_nudged_at: 'x', owner_nudged_at: 'y' } }), now), null);
});

test('reminder texts carry amount, items and reference', () => {
  const c = customerPaymentNudgeText({ businessName: 'Test Shop', order: order() });
  assert.match(c, /1,500 ETB/);
  assert.match(c, /2× Coffee 1kg/);
  assert.match(c, /ABCD1234/);
  assert.match(c, /ደረሰኙን/);
  assert.match(ownerUnpaidText({ customerName: 'Customer A', order: order() }), /Still unpaid.*Customer A.*1,500 ETB/);
});

test('migration adds orders.meta, which the claim flow and cron read', () => {
  const sql = readFileSync(`${here}../../../../../../packages/db/migrations/064_orders_meta.sql`, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS meta JSONB/);
});

test('cron runs unpaid reminders; Not yet no longer names meta in its select', () => {
  const cron = read('../../../app/api/cron/payment-followups/route.js');
  assert.match(cron, /remindUnpaidOrders\(/);
  const engine = read('../replyEngine.js');
  assert.doesNotMatch(engine, /select\('status, meta, payment_method/);
});

test('screenshot from a customer who owes money becomes a claim', () => {
  const engine = read('../replyEngine.js');
  assert.match(engine, /claimFromScreenshot\(\{ token, business, customer, fileId \}\)/);
  const op = read('../orderPayments.js');
  assert.match(op, /receiptFileId: fileId/);
});

test('owner-only order buttons: cancel and mark delivered', () => {
  const engine = read('../replyEngine.js');
  for (const prefix of ['order_cancel_', 'order_fulfill_']) {
    const at = engine.indexOf(`data.startsWith('${prefix}')) {`);
    assert.ok(at > 0, prefix);
    assert.match(engine.slice(at, at + 400), /Only the shop owner/);
  }
  assert.match(engine, /📦 Mark delivered/);
});
