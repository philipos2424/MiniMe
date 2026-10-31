import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildSale, stockAfterSale, saleRecordedText, matchProduct, orderRef, parseOrderRef,
  owedOn, applyPayment, debtSummary, debtsText, staleItems, ordersToExpire, tidyText,
  validateExpense, periodStart, profitText, promoFromArgs, promoText,
  shouldSendBrief, briefText, briefKeyboard, fmtMoney,
} from '../ownerLedger.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');
const now = new Date('2026-10-31T06:00:00Z');
const daysAgo = d => new Date(now - d * 86400000).toISOString();
const products = [
  { id: 'p1', name: 'Coffee 1kg', name_am: 'ቡና', price: 750, stock_quantity: 5, low_stock_threshold: 3 },
  { id: 'p2', name: 'Red dress', price: 1500, stock_quantity: 0 },
  { id: 'p3', name: 'Netflix subscription', price: 400, stock_quantity: 1 },
];

test('products match by exact name, part of the name, Amharic, or shared words', () => {
  assert.equal(matchProduct(products, 'coffee 1kg').id, 'p1');
  assert.equal(matchProduct(products, 'coffee').id, 'p1');
  assert.equal(matchProduct(products, 'ቡና').id, 'p1');
  assert.equal(matchProduct(products, 'the netflix one').id, 'p3');
  assert.equal(matchProduct(products, 'shoes'), null);
});

test('a cash sale uses catalog prices and is paid', () => {
  const s = buildSale({ items: [{ name: 'coffee', quantity: 2 }], products });
  assert.ok(s.ok);
  assert.equal(s.total, 1500);
  assert.equal(s.status, 'paid');
  assert.equal(s.credit, false);
  assert.equal(s.lines[0].product_id, 'p1');
});

test('an unknown item needs a price, unless the owner gave a total', () => {
  assert.match(buildSale({ items: [{ name: 'shoes' }], products }).error, /What price/);
  const s = buildSale({ items: [{ name: 'shoes', quantity: 2 }], products, total: 2000 });
  assert.equal(s.lines[0].unit_price, 1000);
  assert.equal(s.lines[0].product_id, null);
});

test('a total lower than the items is a discount', () => {
  const s = buildSale({ items: [{ name: 'coffee', quantity: 2 }], products, total: 1400 });
  assert.equal(s.subtotal, 1500);
  assert.equal(s.total, 1400);
});

test('credit and partial payments leave money owed', () => {
  const c = buildSale({ items: [{ name: 'red dress' }], products, payment: 'credit' });
  assert.equal(c.status, 'pending_payment');
  assert.equal(c.paidAmount, 0);
  const p = buildSale({ items: [{ name: 'red dress' }], products, payment: 'partial', amountPaid: 500 });
  assert.equal(p.paidAmount, 500);
  assert.ok(p.credit);
  const full = buildSale({ items: [{ name: 'red dress' }], products, payment: 'partial', amountPaid: 1500 });
  assert.equal(full.status, 'paid');
});

test('bad quantities and empty sales are refused', () => {
  assert.equal(buildSale({ items: [] }).ok, false);
  assert.equal(buildSale({ items: [{ name: 'coffee', quantity: 0 }], products }).ok, false);
  assert.equal(buildSale({ items: [{ name: 'coffee', quantity: 1.5 }], products }).ok, false);
});

test('tracked stock goes down, never below zero; untracked (0) is left alone', () => {
  const s = buildSale({ items: [{ name: 'coffee', quantity: 3 }, { name: 'red dress' }, { name: 'netflix', quantity: 2 }], products });
  const ch = stockAfterSale(products, s.lines);
  assert.deepEqual(ch.map(c => [c.id, c.after]), [['p1', 2], ['p3', 0]]);
  assert.ok(ch[0].low);
  const text = saleRecordedText({ sale: s, customerName: 'Abebe', stockChanges: ch, ref: 'AB12CD34' });
  assert.match(text, /to \*Abebe\*/);
  assert.match(text, /sold out/);
  assert.match(text, /running low/);
});

test('order refs are 8 hex characters', () => {
  assert.equal(orderRef('ab12cd34-0000-1111'), 'AB12CD34');
  assert.equal(parseOrderRef('cancel #AB12CD34 please'), 'ab12cd34');
  assert.equal(parseOrderRef('cancel Sara'), null);
});

test('payments go to the oldest debt first; no amount pays it all', () => {
  const orders = [
    { id: 'b', total: 1000, created_at: daysAgo(1), meta: {} },
    { id: 'a', total: 500, created_at: daysAgo(5), meta: { paid_amount: 200 } },
  ];
  assert.equal(owedOn(orders[1]), 300);
  const part = applyPayment(orders, 500);
  assert.deepEqual(part.updates.map(u => [u.id, u.paid_amount, u.fully]), [['a', 500, true], ['b', 200, false]]);
  const all = applyPayment(orders);
  assert.equal(all.applied, 1300);
  const over = applyPayment(orders, 2000);
  assert.equal(over.leftover, 700);
});

test('debts group by person, biggest first, with overdue flags', () => {
  const orders = [
    { id: '1', customer_id: 'c1', customers: { name: 'Abebe', telegram_id: 9 }, total: 500, created_at: daysAgo(10), meta: { due_date: '2026-10-20' } },
    { id: '2', customer_id: 'c1', customers: { name: 'Abebe' }, total: 700, created_at: daysAgo(2), meta: {} },
    { id: '3', customer_id: null, total: 2000, created_at: daysAgo(1), meta: { customer_name: 'Hana' } },
    { id: '4', customer_id: 'c3', total: 100, created_at: daysAgo(1), meta: { paid_amount: 100 } },
  ];
  const d = debtSummary(orders, now);
  assert.deepEqual(d.map(x => [x.name, x.owed, x.count]), [['Hana', 2000, 1], ['Abebe', 1200, 2]]);
  const t = debtsText(d, 'ETB', now);
  assert.match(t, /3,200 ETB total/);
  assert.match(t, /overdue/);
  assert.match(debtsText([], 'ETB', now), /Nobody owes you/);
});

test('stale: unpaid non-credit orders over a week, jobs untouched 3 weeks; credit is never stale', () => {
  const s = staleItems({
    orders: [
      { id: 'o1', status: 'pending_payment', payment_method: 'telebirr_manual', created_at: daysAgo(90), total: 100 },
      { id: 'o2', status: 'pending_payment', payment_method: 'credit', created_at: daysAgo(90), total: 100 },
      { id: 'o3', status: 'pending_payment', payment_method: 'chapa', created_at: daysAgo(2), total: 100 },
    ],
    jobs: [
      { id: 'j1', status: 'draft', updated_at: daysAgo(120), title: 'Logo' },
      { id: 'j2', status: 'active', updated_at: daysAgo(3), title: 'Website' },
      { id: 'j3', status: 'completed', updated_at: daysAgo(120) },
    ],
  }, now);
  assert.deepEqual(s.orders.map(o => o.id), ['o1']);
  assert.deepEqual(s.jobs.map(j => j.id), ['j1']);
  assert.match(tidyText(s), /2 old items/);
  assert.match(tidyText({ orders: [], jobs: [] }), /Nothing old/);
  assert.deepEqual(ordersToExpire([
    { id: 'x', status: 'pending_payment', payment_method: 'chapa', created_at: daysAgo(31) },
    { id: 'y', status: 'pending_payment', payment_method: 'credit', created_at: daysAgo(300) },
  ], now).map(o => o.id), ['x']);
});

test('expenses need an amount; unknown categories become other', () => {
  assert.equal(validateExpense({}).ok, false);
  assert.deepEqual(validateExpense({ amount: '3,000', category: 'Rent' }).expense, { amount: 3000, category: 'rent', note: null });
  assert.equal(validateExpense({ amount: 50, category: 'snacks' }).expense.category, 'other');
});

test('periods start at Ethiopian midnight, Monday, and the 1st', () => {
  assert.equal(periodStart('today', now).toISOString(), '2026-10-30T21:00:00.000Z');
  assert.equal(periodStart('week', now).toISOString(), '2026-10-25T21:00:00.000Z'); // Mon 26 Oct EAT
  assert.equal(periodStart('month', now).toISOString(), '2026-09-30T21:00:00.000Z');
});

test('profit is sales minus costs, credit noted separately', () => {
  const t = profitText({ revenue: 10000, salesCount: 4, expenses: [{ amount: 3000, category: 'rent' }, { amount: 500, category: 'transport' }], owed: 1200 });
  assert.match(t, /Profit: 6,500 ETB/);
  assert.match(t, /rent: 3,000/);
  assert.match(t, /Still owed to you: 1,200/);
  assert.match(profitText({ revenue: 100, salesCount: 1, expenses: [{ amount: 300 }] }), /Loss: 200/);
  assert.match(profitText({}), /Nothing recorded yet/);
});

test('promotions: percent or amount, sensible code, future end date', () => {
  const p = promoFromArgs({ percent_off: 10, ends_iso: '2026-11-02' }, now);
  assert.ok(p.ok);
  assert.equal(p.promo.code, 'SAVE10');
  assert.equal(p.promo.type, 'percent');
  assert.equal(p.promo.expires_at, '2026-11-02T20:59:00.000Z');
  assert.equal(promoFromArgs({ amount_off: 100, code: 'eid-20!' }, now).promo.code, 'EID20');
  assert.equal(promoFromArgs({}, now).ok, false);
  assert.equal(promoFromArgs({ percent_off: 95 }, now).ok, false);
  assert.equal(promoFromArgs({ percent_off: 10, ends_iso: '2026-10-01' }, now).ok, false);
  assert.match(promoText(p.promo), /10% off with code \*SAVE10\*/);
});

test('brief: on = always; default = only active shops with something to do; off = never', () => {
  const busy = { waiting: 2 };
  assert.equal(shouldSendBrief({ enabled: true }, {}, {}), true);
  assert.equal(shouldSendBrief({ enabled: false }, busy, { activeRecently: true }), false);
  assert.equal(shouldSendBrief(undefined, busy, { activeRecently: true }), true);
  assert.equal(shouldSendBrief(undefined, {}, { activeRecently: true }), false);
  assert.equal(shouldSendBrief(undefined, busy, { activeRecently: false }), false);
});

test('brief text and buttons follow what needs doing', () => {
  const s = { revenue: 4500, messages: 12, waiting: 3, debtors: 2, owed: 1700, overdue: 1, lowStock: 1, stale: 22 };
  const t = briefText(s, { businessName: 'iconnect', ownerFirst: 'Phili', hour: 8 });
  assert.match(t, /Good morning, Phili/);
  assert.match(t, /4,500 ETB in sales/);
  assert.match(t, /2 people owe you 1,700 ETB \(1 overdue\)/);
  assert.match(t, /22 old orders/);
  const cbs = briefKeyboard(s).flat().map(b => b.callback_data);
  for (const c of ['owner_inbox', 'ops_debts', 'ops_stock', 'ops_tidy', 'ops_profit', 'ops_brief_off']) assert.ok(cbs.includes(c), c);
  for (const c of cbs) assert.ok(Buffer.byteLength(c) <= 64);
  assert.deepEqual(briefKeyboard({}).flat().map(b => b.callback_data), ['ops_profit', 'ops_brief_off']);
  assert.match(briefText({}), /Nothing needs you/);
});

test('callback data with uuids fits Telegram limits', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.ok(Buffer.byteLength(`ops_undo_${id}`) <= 64);
  assert.ok(Buffer.byteLength(`ops_remind_${id}`) <= 64);
});

test('money formatting', () => {
  assert.equal(fmtMoney(1500), '1,500 ETB');
  assert.equal(fmtMoney(12.5, 'USD'), '12.5 USD');
});

test('owner agent has the books tools, wired and explained', () => {
  const oc = read('../ownerCommands.js');
  for (const t of ['record_sale', 'customer_paid', 'update_order', 'list_debts', 'record_expense', 'profit_summary', 'edit_product', 'create_promotion', 'tidy_up', 'morning_brief']) {
    assert.match(oc, new RegExp(`name: '${t}'`), `tool ${t}`);
    assert.match(oc, new RegExp(`c\\.function\\.name === '${t}'`), `dispatch ${t}`);
  }
  assert.match(oc, /THE BOOKS/);
  assert.match(oc, /inline_keyboard: out\.keyboard/);
  assert.match(oc, /const SOLD = \['paid', 'fulfilled'\]/);
  assert.doesNotMatch(oc, /eq\('status', 'paid'\)\.gte\('paid_at'/);
});

test('ops buttons are owner-only and slash commands exist', () => {
  const engine = read('../replyEngine.js');
  const at = engine.indexOf("if (data.startsWith('ops_')) {");
  assert.ok(at > 0);
  assert.match(engine.slice(at, at + 300), /Only the shop owner/);
  assert.match(engine, /\(debts\|profit\|tidy\)/);
});

test('advisor ignores jobs nobody touched in three weeks', () => {
  assert.match(read('../advisor.js'), /\.gte\('updated_at', new Date\(Date\.now\(\) - 21 \* 86400000\)/);
});

test('morning brief cron uses the actionable brief and expires month-old unpaid orders', () => {
  const cron = read('../../../app/api/cron/morning-briefing/route.js');
  assert.match(cron, /sendMorningBrief\(/);
  assert.match(cron, /expireOldOrders\(\)/);
  const sql = read('../../../../../../packages/db/migrations/066_business_expenses.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS business_expenses/);
});

test('undo restores only the stock the sale moved', () => {
  const ops = read('../ownerOps.js');
  assert.match(ops, /stock_moved: changes\.map/);
  assert.match(ops, /const moved = \(o\.meta\?\.stock_moved/);
});
