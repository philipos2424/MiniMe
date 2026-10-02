import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as purchaseHelpers from '../../subscriptionPurchase.mjs';

const scenario = process.argv[2];
const effects = [];
const secret = 'whsec_test_only_not_a_real_secret';
const purchase = { reference: 'server-purchase', business_id: 'stored-business', provider: 'stripe', plan: 'pro', duration_months: 12, amount_minor: 22800, currency: 'USD' };
const payload = {
  type: 'checkout.session.completed',
  data: { object: {
    payment_status: 'paid', amount_total: scenario === 'mismatch' ? 100 : 22800,
    currency: 'usd', client_reference_id: 'forged-business',
    metadata: { txRef: purchase.reference, businessId: 'forged-business', plan: 'business', durationMonths: 99 },
  } },
};
const sb = { from(table) {
  effects.push(['read', table]);
  return {
    select() { return this; },
    eq(column, value) { effects.push(['filter', table, column, value]); return this; },
    async maybeSingle() {
      if (scenario === 'read-failure') return { data: null, error: new Error('database unavailable') };
      if (table === 'subscription_purchases') return { data: purchase };
      assert.equal(table, 'businesses');
      return { data: { id: 'stored-business', plan_tier: 'pro', subscription_expires_at: '2027-10-01T00:00:00Z' } };
    },
  };
} };
const mocks = {
  'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
  'node:crypto': { default: crypto },
  '../../../../lib/server/subscriptionPurchase.mjs': purchaseHelpers,
  '../../../../lib/server/billing': { async upgradeSubscription(id, options) {
    effects.push(['grant', id, options]);
    if (scenario === 'grant-failure') throw new Error('transaction failed');
    return { duplicate: scenario === 'duplicate' };
  } },
  '../../../../lib/server/db': { supabase: () => sb },
  '../../../../lib/server/platformSettings': { getSetting: async () => { throw new Error('Stripe must not read other gateway settings'); } },
  '../../../../lib/server/audit': { audit: async data => { effects.push(['audit', data.action]); } },
  '../../../../lib/server/trialActivation': {
    sendTrialActivatedMessage: async () => { effects.push(['notify-owner']); },
    notifyAdminActivation: async () => { effects.push(['notify-admin']); },
  },
};
const context = vm.createContext({
  Buffer, Date, console: { error() {}, warn() {} },
  process: { env: { STRIPE_WEBHOOK_SECRET: secret } },
});
const source = readFileSync(new URL('../../../../app/api/payment/webhook/route.js', import.meta.url), 'utf8');
const mod = new vm.SourceTextModule(source, { context });
await mod.link(specifier => {
  assert.ok(mocks[specifier], `Unmocked dependency ${specifier}`);
  const values = mocks[specifier];
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
});
await mod.evaluate();
const raw = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000) - (scenario === 'expired-signature' ? 600 : 0);
const signature = crypto.createHmac('sha256', scenario === 'bad-signature' ? 'wrong-secret' : secret).update(`${timestamp}.${raw}`).digest('hex');
const headers = new Headers(scenario === 'unsigned' ? {} : { 'stripe-signature': `t=${timestamp},v1=${signature}` });
const result = await mod.namespace.POST({ headers, text: async () => raw });
const grants = effects.filter(e => e[0] === 'grant');
const notifications = effects.filter(e => e[0].startsWith('notify-'));
if (['unsigned', 'bad-signature', 'expired-signature'].includes(scenario)) {
  assert.equal(result.status, 401);
  assert.deepEqual(effects, [], 'unverified callbacks must not query the database or grant');
} else if (scenario === 'mismatch') {
  assert.equal(result.status, 409);
  assert.equal(grants.length, 0);
  assert.equal(notifications.length, 0);
  assert.ok(effects.some(e => e[0] === 'audit' && e[1] === 'payment.reconciliation_required'));
} else if (['read-failure', 'grant-failure'].includes(scenario)) {
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'payment_processing_failed');
  assert.equal(grants.length, scenario === 'grant-failure' ? 1 : 0);
  assert.equal(notifications.length, 0);
} else {
  assert.equal(result.status, 200);
  assert.equal(grants.length, 1);
  assert.equal(grants[0][1], 'stored-business');
  assert.equal(grants[0][2].planName, 'pro');
  assert.equal(grants[0][2].paymentReference, 'server-purchase');
  assert.equal(grants[0][2].verifiedPayment.amountMinor, 22800);
  assert.equal(grants[0][2].durationMonths, undefined, 'signed client metadata cannot choose the term');
  if (scenario === 'duplicate') {
    assert.equal(result.body.status, 'duplicate');
    assert.equal(notifications.length, 0);
    assert.equal(effects.filter(e => e[0] === 'read' && e[1] === 'businesses').length, 0);
  } else {
    assert.equal(notifications.length, 2);
    assert.ok(effects.some(e => e[0] === 'filter' && e[1] === 'businesses' && e[3] === 'stored-business'));
  }
}
