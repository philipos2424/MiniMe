import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSubscriptionPurchase, verifiedPurchasePayment, matchesPurchase, confirmChapaPayment } from '../subscriptionPurchase.mjs';

test('real billing route handlers enforce authentication, ownership and tenant binding', () => {
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('./fixtures/billingRoutes.mjs', import.meta.url))], { encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 0, child.error?.message || child.stderr || child.stdout);
});

test('only supported integer subscription terms and paid plans validate', () => {
  for (const durationMonths of [1, 12]) assert.equal(validateSubscriptionPurchase({ plan: 'pro', method: 'stripe', durationMonths }), true);
  for (const body of [null, [], 'pro', { plan: 'free' }, { plan: 'business' }, { method: 'unknown' }, { durationMonths: 0 }, { durationMonths: -1 }, { durationMonths: 1.5 }, { durationMonths: '12' }, { durationMonths: 24 }]) {
    assert.equal(validateSubscriptionPurchase(body), false);
  }
  for (const method of ['bank', 'telebirr', 'cbe', 'paypal']) {
    assert.equal(validateSubscriptionPurchase({ method, durationMonths: 12 }), false);
  }
});

test('Chapa payouts and refunded transactions cannot activate subscriptions', () => {
  for (const body of [
    { event: 'payout.success', status: 'success', amount: '1999', currency: 'ETB' },
    { event: 'charge.success', status: 'refunded', amount: '1999', currency: 'ETB' },
  ]) assert.equal(verifiedPurchasePayment('chapa', body), null);
});

test('Chapa confirmation requires matching API evidence and environment', async () => {
  const payment = { reference: 'purchase-1', amountMinor: 199900, currency: 'ETB' };
  const data = { status: 'success', mode: 'live', tx_ref: 'purchase-1', amount: '1999.00', currency: 'ETB' };
  const response = patch => async () => ({ ok: true, json: async () => ({ status: 'success', data: { ...data, ...patch } }) });
  assert.deepEqual(await confirmChapaPayment(payment, 'CHASECK-live-testfixture', response({})), payment);
  for (const patch of [{ status: 'failed' }, { mode: 'test' }, { mode: undefined }, { tx_ref: 'other' }, { amount: '1' }, { currency: 'USD' }]) {
    assert.equal(await confirmChapaPayment(payment, 'CHASECK-live-testfixture', response(patch)), null);
  }
  await assert.rejects(confirmChapaPayment(payment, 'fixture', async () => ({ ok: false })), /unavailable/);
});

test('Stripe unpaid sessions and unrelated event types cannot grant access', () => {
  const paid = { type: 'checkout.session.completed', data: { object: { payment_status: 'paid', amount_total: 1900, currency: 'usd', metadata: { txRef: 'purchase-1' } } } };
  assert.deepEqual(verifiedPurchasePayment('stripe', paid), { reference: 'purchase-1', amountMinor: 1900, currency: 'USD' });
  assert.equal(verifiedPurchasePayment('stripe', { ...paid, type: 'checkout.session.expired' }), null);
  assert.equal(verifiedPurchasePayment('stripe', { ...paid, data: { object: { ...paid.data.object, payment_status: 'unpaid' } } }), null);
});

test('verified payments must match immutable reference, provider, currency and exact amount', () => {
  const record = { reference: 'purchase-1', provider: 'stripe', amount_minor: 1900, currency: 'USD' };
  const payment = { reference: 'purchase-1', amountMinor: 1900, currency: 'USD' };
  assert.equal(matchesPurchase(record, 'stripe', payment), true);
  assert.equal(matchesPurchase(null, 'stripe', payment), false);
  assert.equal(matchesPurchase(record, 'chapa', payment), false);
  for (const patch of [{ reference: 'other' }, { currency: 'ETB' }, { amountMinor: 1899 }, { amountMinor: '1900' }, { amountMinor: Infinity }, { amountMinor: 1900.5 }]) {
    assert.equal(matchesPurchase(record, 'stripe', { ...payment, ...patch }), false);
  }
});
