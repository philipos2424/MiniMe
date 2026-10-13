import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as plan from '../../plan.js';

// Load the module with its database and settings swapped for in-memory fakes.
const source = readFileSync(new URL('../subscriptionPayments.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/export async function /g, 'async function ');

function fakeDb(rows) {
  const tables = { businesses: rows.businesses || [], subscription_events: rows.subscription_events || [] };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.op = 'select'; }
    select() { if (this.op !== 'update') this.op = 'select'; this.returning = true; return this; }
    update(values) { this.op = 'update'; this.values = values; return this; }
    insert(row) { tables[this.table].push({ ...row }); return Promise.resolve({ data: null, error: null }); }
    eq(k, v) { this.filters.push(r => r[k] === v); return this; }
    in(k, list) { this.filters.push(r => list.includes(r[k])); return this; }
    contains(k, obj) { this.filters.push(r => Object.entries(obj).every(([a, b]) => r[k]?.[a] === b)); return this; }
    limit() { return this; }
    maybeSingle() { this.single = true; return this; }
    then(resolve) {
      const hits = tables[this.table].filter(r => this.filters.every(f => f(r)));
      if (this.op === 'update') hits.forEach(r => Object.assign(r, this.values));
      const data = this.single ? (hits[0] || null) : hits.map(r => ({ ...r }));
      return Promise.resolve({ data, error: null }).then(resolve);
    }
  }
  return { tables, client: { from: t => new Query(t) } };
}

function load({ db, settings = {}, fetchImpl }) {
  const factory = new Function('supabase', 'getSetting', 'PRO_PERIODS', 'periodForAmount', 'fetch', 'Buffer',
    `${source}\nreturn { completeChapaSubscription, completeStripeSession, completePaypalOrder };`);
  return factory(() => db.client, async key => settings[key] || null, plan.PRO_PERIODS, plan.periodForAmount, fetchImpl, Buffer);
}

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const BIZ = 'b1';
const freshBusiness = (extra = {}) => ({ id: BIZ, subscription_status: 'trial', subscription_expires_at: null, owner_telegram_id: null, ...extra });

test('a forged or unpaid Chapa payment grants nothing', async () => {
  const db = fakeDb({ businesses: [freshBusiness({ payment_ref: 'sub-chap-1' })] });
  const api = load({ db, settings: { 'gateway.chapa.secret': 'k' }, fetchImpl: async () => json(200, { data: { status: 'failed', amount: 3500, currency: 'ETB' } }) });
  const result = await api.completeChapaSubscription('sub-chap-1');
  assert.equal(result.ok, false);
  assert.equal(db.tables.businesses[0].subscription_status, 'trial');
});

test('a verified Chapa payment grants the period its amount covers, exactly once', async () => {
  const db = fakeDb({ businesses: [freshBusiness({ payment_ref: 'sub-chap-2' })] });
  const api = load({ db, settings: { 'gateway.chapa.secret': 'k' }, fetchImpl: async () => json(200, { data: { status: 'success', amount: '3500.00', currency: 'ETB' } }) });
  const first = await api.completeChapaSubscription('sub-chap-2');
  assert.equal(first.ok, true);
  assert.equal(first.period, 'pro_quarterly');
  const biz = db.tables.businesses[0];
  assert.equal(biz.subscription_status, 'active');
  const expiry = biz.subscription_expires_at;
  // Chapa delivers twice (GET return + POST webhook): the second is a no-op.
  const second = await api.completeChapaSubscription('sub-chap-2');
  assert.equal(second.duplicate, true);
  assert.equal(biz.subscription_expires_at, expiry);
  assert.equal(db.tables.subscription_events.length, 1);
});

test('a Chapa gateway outage is retryable and changes nothing', async () => {
  const db = fakeDb({ businesses: [freshBusiness({ payment_ref: 'sub-chap-3' })] });
  const api = load({ db, settings: { 'gateway.chapa.secret': 'k' }, fetchImpl: async () => { throw new Error('down'); } });
  const result = await api.completeChapaSubscription('sub-chap-3');
  assert.equal(result.retryable, true);
  assert.equal(db.tables.businesses[0].subscription_status, 'trial');
});

test('a payment still credits after the owner started a second checkout', async () => {
  // payment_ref now names the newer checkout; the older Stripe payment is real.
  const db = fakeDb({ businesses: [freshBusiness({ payment_ref: 'sub-chap-newer' })] });
  const api = load({ db, settings: { 'gateway.stripe.secret': 'k' }, fetchImpl: async () => json(200, {
    id: 'cs_test_1', payment_status: 'paid', amount_total: 900, currency: 'usd', metadata: { businessId: BIZ, txRef: 'sub-stri-old' },
  }) });
  const result = await api.completeStripeSession('cs_test_1');
  assert.equal(result.ok, true);
  assert.equal(db.tables.businesses[0].subscription_status, 'active');
  assert.equal((await api.completeStripeSession('cs_test_1')).duplicate, true);
});

test('an unpaid Stripe session or a made-up id grants nothing', async () => {
  const db = fakeDb({ businesses: [freshBusiness()] });
  const api = load({ db, settings: { 'gateway.stripe.secret': 'k' }, fetchImpl: async () => json(200, { id: 'cs_x', payment_status: 'unpaid', metadata: { businessId: BIZ } }) });
  assert.equal((await api.completeStripeSession('cs_x')).ok, false);
  assert.equal((await api.completeStripeSession('not-a-session')).ok, false);
  assert.equal(db.tables.businesses[0].subscription_status, 'trial');
});

test('an approved PayPal order is captured, then credited to the business on the order', async () => {
  const db = fakeDb({ businesses: [freshBusiness({ payment_ref: 'sub-payp-1' })] });
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url}`);
    if (url.endsWith('/oauth2/token')) return json(200, { access_token: 't' });
    if (url.endsWith('/capture')) return json(201, { id: 'ORDER12345', status: 'COMPLETED', purchase_units: [{ reference_id: 'sub-payp-1', custom_id: BIZ, payments: { captures: [{ status: 'COMPLETED', amount: { value: '9', currency_code: 'USD' } }] } }] });
    return json(200, { id: 'ORDER12345', status: 'APPROVED', purchase_units: [{ reference_id: 'sub-payp-1', custom_id: BIZ }] });
  };
  const api = load({ db, settings: { 'gateway.paypal.id': 'i', 'gateway.paypal.secret': 's' }, fetchImpl });
  const result = await api.completePaypalOrder('ORDER12345');
  assert.equal(result.ok, true);
  assert.ok(calls.some(c => c.startsWith('POST') && c.endsWith('/capture')));
  assert.equal(db.tables.businesses[0].subscription_status, 'active');
});

test('renewing early extends from the current expiry, not from today', async () => {
  const future = new Date(Date.now() + 10 * 86400000);
  const db = fakeDb({ businesses: [freshBusiness({ subscription_status: 'active', subscription_expires_at: future.toISOString(), payment_ref: 'sub-chap-4' })] });
  const api = load({ db, settings: { 'gateway.chapa.secret': 'k' }, fetchImpl: async () => json(200, { data: { status: 'success', amount: 1300, currency: 'ETB' } }) });
  await api.completeChapaSubscription('sub-chap-4');
  const expected = new Date(future); expected.setMonth(expected.getMonth() + 1);
  assert.equal(db.tables.businesses[0].subscription_expires_at, expected.toISOString());
});

test('the payment webhook ignores a body that only claims to be paid', async () => {
  const route = readFileSync(new URL('../../../app/api/payment/webhook/route.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace(/export (async )?function /g, '$1function ').replace(/export const .*$/gm, '');
  const credited = [];
  const done = id => { credited.push(id); return { ok: true }; };
  const make = new Function('NextResponse', 'completeChapaSubscription', 'completePaypalOrder', 'completeStripeSession', 'rateLimit', 'getIP',
    `${route}\nreturn { POST };`);
  const { POST } = make(
    { json: (body, init) => ({ body, status: init?.status || 200 }) },
    done, done, done, () => ({ ok: true }), () => '1.1.1.1');
  const req = body => ({ url: 'https://x/api/payment/webhook', text: async () => JSON.stringify(body) });

  for (const forged of [{ businessId: 'b1', paid: true }, { businessId: 'b1', status: 'completed', plan: 'pro' }, { metadata: { businessId: 'b1' }, status: 'success' }]) {
    const res = await POST(req(forged));
    assert.equal(res.body.status, 'ignored');
  }
  assert.equal(credited.length, 0);
  // A real notification is passed on — by id only — to be verified with the gateway.
  await POST(req({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { businessId: 'b1' } } } }));
  assert.deepEqual(credited, ['cs_1']);
});
