/**
 * Customer order payments with no Chapa account (Telebirr / CBE are the main
 * path). tryCheckout() used to cancel every order as "Chapa link failed" and
 * tell nobody; create_order had no Telebirr button.
 *
 * tryCheckout can't be imported (replyEngine needs the full runtime), so its
 * source is run against fakes, the same technique as subscriptionPayments.test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pay from '../customerPayments.mjs';

const engine = readFileSync(new URL('../replyEngine.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = engine.indexOf('async function tryCheckout(');
const end = engine.indexOf('\n}\n', start) + 2;
const tryCheckoutSrc = engine.slice(start, end);

function fakeDb() {
  const rows = { orders: [], discounts: [] };
  let n = 0;
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
    select() { return this; }
    insert(r) { this.op = 'insert'; this.row = { id: `0rd3r${++n}-aaaa-bbbb-cccc-dddddddddddd`, created_at: new Date().toISOString(), ...r }; return this; }
    update(v) { this.op = 'update'; this.v = v; return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; }
    limit() { return this; }
    single() { return this; }
    then(res) {
      if (this.op === 'insert') { rows[this.t].push(this.row); return Promise.resolve({ data: this.row, error: null }).then(res); }
      const hits = rows[this.t].filter(r => this.f.every(f => f(r)));
      if (this.op === 'update') hits.forEach(r => Object.assign(r, this.v));
      return Promise.resolve({ data: hits, error: null }).then(res);
    }
  }
  return { rows, client: { from: t => new Q(t) } };
}

async function runCheckout({ payments, chapaKey = null, chapaLink = null }) {
  const db = fakeDb();
  const sent = [];
  const deps = {
    looksLikeCustomization: () => false,
    getProducts: async () => [],
    extractOrder: async () => ({
      is_order: true, confidence: 0.95,
      items: [{ name: 'NFC card', quantity: 2, subtotal: 1500, currency: 'ETB', stock_available: null }],
    }),
    isAmharic: () => false,
    tg: (token, method, body) => { sent.push({ method, body }); return Promise.resolve({ ok: true }); },
    supabase: () => db.client,
    generateChapaLink: async () => chapaLink,
    chapaKey: async () => chapaKey,
    saveMessage: async () => {},
    ownerChatId: b => b.owner_telegram_id,
    ...pay,
  };
  const fn = new Function(...Object.keys(deps), `${tryCheckoutSrc}\nreturn tryCheckout;`)(...Object.values(deps));
  const business = { id: 'biz-1234-5678', name: 'iconnect', owner_telegram_id: 999, notification_prefs: { payments } };
  const customer = { id: 'cust-1', name: 'Abebe', telegram_username: null };
  const handled = await fn('TOKEN', business, customer, { id: 'conv-1' }, 'I want 2 cards, deliver to Bole, 0911223344', 111, 5);
  return { handled, db, sent, toCustomer: sent.filter(s => s.body.chat_id === 111), toOwner: sent.filter(s => s.body.chat_id === 999) };
}

test('no Chapa key: the order is never cancelled and reaches the owner', async () => {
  // chapa: true is what old Settings saved by default; without a key it must not matter.
  const r = await runCheckout({ payments: { chapa: true, telebirr_manual: true, telebirr_phone: '0911000111', telebirr_name: 'Selam' } });
  assert.equal(r.handled, true);
  const order = r.db.rows.orders[0];
  assert.equal(order.status, 'pending_payment');
  assert.notEqual(order.owner_note, 'Chapa link failed');
  assert.equal(order.payment_method, 'telebirr_manual');
  assert.equal(r.toOwner.length, 1);
  assert.match(r.toOwner[0].body.text, /New order/);
  assert.match(r.toOwner[0].body.text, /Telebirr details/);
});

test('no Chapa key: the customer gets the Telebirr / CBE details and an "I\'ve paid" button', async () => {
  const r = await runCheckout({ payments: { telebirr_manual: true, telebirr_phone: '0911000111', cbe_manual: true, cbe_account: '1000123456789' } });
  const summary = r.toCustomer[0].body;
  assert.match(summary.text, /0911000111/);
  assert.match(summary.text, /1000123456789/);
  assert.match(summary.text, /Reference: `0RD3R1-A`/);
  const buttons = summary.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(b => b.callback_data?.startsWith('cbe_sent_')), 'I\'ve paid button');
  assert.equal(r.db.rows.orders[0].payment_method, 'manual');
});

test('no payment method at all: still not cancelled, and the owner is warned', async () => {
  const r = await runCheckout({ payments: {} });
  assert.equal(r.db.rows.orders[0].status, 'pending_payment');
  assert.match(r.toCustomer[0].body.text, /will send you payment details/);
  assert.match(r.toOwner[0].body.text, /No payment method is set up/);
});

test('Chapa is used only with a key AND the shop turned it on', async () => {
  const link = { url: 'https://checkout.chapa.co/x', txRef: 'tx1' };
  const on = await runCheckout({ payments: { chapa: true }, chapaKey: 'k', chapaLink: link });
  assert.match(on.toCustomer[0].body.text, /checkout\.chapa\.co/);
  assert.equal(on.db.rows.orders[0].checkout_url, link.url);
  const off = await runCheckout({ payments: {}, chapaKey: 'k', chapaLink: link });
  assert.doesNotMatch(off.toCustomer[0].body.text, /chapa/i);
});

test('tryCheckout has no cancel path left', () => {
  assert.doesNotMatch(tryCheckoutSrc, /status: 'cancelled'/);
  assert.doesNotMatch(tryCheckoutSrc, /\.catch\(\(\) => \{\}\);\s*\n\s*\}/, 'no .catch on a query builder');
});

test('create_order offers Telebirr when it is enabled', () => {
  const order = { id: 'o1' };
  const methods = pay.enabledMethods({ telebirr_manual: true, telebirr_phone: '0911000111' });
  const rows = pay.orderPayButtons({ order, pmts: {}, methods, total: 100, currency: 'ETB' });
  assert.deepEqual(rows, [[{ text: '📱 Pay via Telebirr', callback_data: 'pay_telebirr_o1' }]]);
  const brain = readFileSync(new URL('../agentBrain.js', import.meta.url), 'utf8');
  assert.match(brain, /orderPayButtons\(\{ order, pmts, methods, total, currency, chapaUrl: checkoutUrl \}\)/);
  assert.doesNotMatch(brain, /\|\| \{ chapa: true \}/);
});

test('Telebirr uses the same claim / confirm callbacks as CBE', () => {
  assert.match(engine, /data\.startsWith\('pay_telebirr_'\)/);
  assert.deepEqual(pay.paidButton({ id: 'o1' }), [{ text: "✓ I've paid", callback_data: 'cbe_sent_o1' }]);
  // Telegram caps callback_data at 64 bytes.
  assert.ok(`pay_telebirr_${'x'.repeat(36)}`.length <= 64);
});

test('enabledMethods: chapa needs a key, manual rails need their details', () => {
  assert.deepEqual(pay.enabledMethods({ chapa: true }), { chapa: false, stars: false, cbe: false, telebirr: false });
  assert.equal(pay.enabledMethods({ chapa: true }, { chapaKey: 'k' }).chapa, true);
  assert.equal(pay.enabledMethods({ telebirr_manual: true, telebirr_phone: '  ' }).telebirr, false);
  assert.equal(pay.enabledMethods({ cbe_manual: true, cbe_account: '1000' }).cbe, true);
  assert.equal(pay.methodLabel('telebirr_manual'), 'Telebirr');
});

test('Settings → Payments hides Chapa without a key and stops defaulting to it', () => {
  const route = readFileSync(new URL('../../../app/api/settings/payments/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /\|\| \{ chapa: true \}/);
  assert.match(route, /chapa_available: !!\(await chapaKey\(\)\)/);
  const page = readFileSync(new URL('../../../app/(dashboard)/settings/payments/page.js', import.meta.url), 'utf8');
  assert.match(page, /\{chapaAvailable && \(/);
});
