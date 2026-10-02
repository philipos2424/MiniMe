// Run with --experimental-vm-modules. All route imports are mocked; no real
// database, environment credentials, network or Next runtime is loaded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as purchase from '../../subscriptionPurchase.mjs';

let identity = null;
let settings = null;
const effects = [];
const unexpected = name => () => { effects.push(name); throw new Error(`Unexpected ${name}`); };
const context = vm.createContext({
  console, Buffer, URL, URLSearchParams,
  process: { env: { NODE_ENV: 'production', WEB_URL: 'https://example.test' } },
  fetch: unexpected('fetch'),
});
const mocks = {
  'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
  '../../../../lib/server/auth': {
    authenticate: async () => identity,
    requireOwner: (business, user) => business.owner_telegram_id === user.id,
  },
  '../../../../lib/server/subscriptionPurchase.mjs': purchase,
  'node:crypto': { default: crypto },
  '../../../../lib/server/billing': {
    SUBSCRIPTION_PLANS: { pro: { id: 'pro', name: 'Pro', priceMonthlyUsd: 19 } },
    upgradeSubscription: unexpected('grant'),
    planPriceEtb: () => 2500,
    getBillingOverview: async id => { effects.push(['overview', id]); return { businessId: id }; },
  },
  '../../../../lib/server/db': { supabase: unexpected('database') },
  '../../../../lib/server/platformSettings': {
    getSetting: async key => settings ? settings[key] : unexpected('settings')(),
    getSettings: async () => settings || unexpected('settings')(),
  },
};
async function load(relative) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(specifier => {
    assert.ok(mocks[specifier], `Unmocked dependency ${specifier}`);
    const values = mocks[specifier];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await mod.evaluate();
  return mod.namespace;
}
const billing = await load('../../../../app/api/billing/subscription/route.js');
const subscribe = await load('../../../../app/api/payment/subscribe/route.js');
const request = body => ({
  url: 'https://example.test/api/billing/subscription?businessId=victim-business',
  headers: new Headers({ 'x-business-id': 'victim-business' }),
  json: async () => body,
});
for (const auth of [null, { business: { id: 'owned', owner_telegram_id: 1 }, tgUser: { id: 2 } }]) {
  identity = auth;
  const expected = auth ? 403 : 401;
  assert.equal((await billing.GET(request())).status, expected);
  assert.equal((await subscribe.POST(request({ method: 'stripe' }))).status, expected);
  assert.deepEqual(effects, [], 'rejected callers must cause no downstream effects');
}
identity = { business: { id: 'owned', owner_telegram_id: 1 }, tgUser: { id: 1 } };
assert.equal((await billing.GET(request())).body.businessId, 'owned');
assert.deepEqual(effects, [['overview', 'owned']], 'forged tenant selectors must be ignored');
effects.length = 0;
for (const body of [null, [], { plan: 'business' }, { durationMonths: -1 }, { durationMonths: '12' }, { durationMonths: 2 }]) {
  assert.equal((await subscribe.POST(request(body))).status, 400);
}
assert.deepEqual(effects, [], 'invalid purchases must not create sessions or access settings');
settings = { 'gateway.stripe.secret': 'fixture-key', 'gateway.chapa.secret': 'fixture-key' };
let rails = await subscribe.availableRails();
assert.equal(rails.stripe, false);
assert.equal(rails.chapa, false);
assert.equal(rails.paypal, false);
for (const method of ['stripe', 'chapa', 'paypal']) {
  assert.equal((await subscribe.POST(request({ method }))).status, 503);
}
assert.deepEqual(effects, [], 'missing webhook configuration must not create purchases or sessions');
context.process.env.STRIPE_WEBHOOK_SECRET = 'stripe-fixture';
context.process.env.CHAPA_WEBHOOK_SECRET = 'chapa-fixture';
rails = await subscribe.availableRails();
assert.equal(rails.stripe, true);
assert.equal(rails.chapa, true);
console.log('Billing route authentication, ownership, tenant binding and validation passed.');
