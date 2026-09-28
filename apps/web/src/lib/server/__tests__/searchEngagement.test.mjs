import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSearchEngagement, pairKey } from '../searchEngagement.mjs';

// EAT day boundaries, expressed in UTC the way pulse/route.js builds them:
// the EAT day starts at 21:00 UTC the previous calendar day.
const YESTERDAY_START = '2026-08-13T21:00:00.000Z';
const TODAY_START     = '2026-08-14T21:00:00.000Z';
const NOW             = '2026-08-15T09:00:00.000Z';

const WINDOW = { todayStart: TODAY_START, yesterdayStart: YESTERDAY_START, nowIso: NOW };

const ref = (biz, tg, created_at, first_message_at = null) => ({
  business_id: biz, customer_telegram_id: tg, created_at, first_message_at,
});
const cust = (id, biz, tg) => ({ id, business_id: biz, telegram_id: tg });
const order = (customer_id, business_id, total, status, created_at) => ({
  customer_id, business_id, total, status, created_at,
});

const agg = (over = {}) => aggregateSearchEngagement({ ...WINDOW, ...over });

// ── Arrivals ────────────────────────────────────────────────────────────────

test('empty input yields zeros, not nulls or NaN', () => {
  const r = agg();
  assert.deepEqual(r.today, { landed: 0, talking: 0, orders: 0, gmv_etb: 0 });
  assert.deepEqual(r.yesterday, { landed: 0, talking: 0, orders: 0, gmv_etb: 0 });
  assert.deepEqual(r.topReceivers, []);
});

test('counts distinct shoppers, not referral rows — a triple-tap is one arrival', () => {
  // search_referrals has no unique constraint on (business_id, customer_telegram_id),
  // so tapping the search link three times writes three rows for one person.
  const r = agg({
    referrals: [
      ref('biz-1', '900', '2026-08-15T07:00:00.000Z'),
      ref('biz-1', '900', '2026-08-15T07:05:00.000Z'),
      ref('biz-1', '900', '2026-08-15T08:20:00.000Z'),
    ],
  });
  assert.equal(r.today.landed, 1);
});

test('the same shopper landing on two different businesses counts once per business', () => {
  const r = agg({
    referrals: [
      ref('biz-1', '900', '2026-08-15T07:00:00.000Z'),
      ref('biz-2', '900', '2026-08-15T07:10:00.000Z'),
    ],
  });
  assert.equal(r.today.landed, 2);
});

test('splits arrivals across the EAT day boundary', () => {
  const r = agg({
    referrals: [
      // 20:59 UTC on the 14th is still YESTERDAY in EAT (day flips at 21:00 UTC).
      ref('biz-1', '900', '2026-08-14T20:59:00.000Z'),
      ref('biz-1', '901', '2026-08-14T21:00:00.000Z'), // first instant of today
      ref('biz-1', '902', '2026-08-15T08:00:00.000Z'),
    ],
  });
  assert.equal(r.yesterday.landed, 1);
  assert.equal(r.today.landed, 2);
});

test('ignores referrals outside both windows', () => {
  const r = agg({ referrals: [ref('biz-1', '900', '2026-08-01T10:00:00.000Z')] });
  assert.equal(r.today.landed, 0);
  assert.equal(r.yesterday.landed, 0);
});

test('normalizes numeric vs string telegram ids when deduping', () => {
  const r = agg({
    referrals: [
      ref('biz-1', 900, '2026-08-15T07:00:00.000Z'),
      ref('biz-1', '900', '2026-08-15T07:30:00.000Z'),
    ],
  });
  assert.equal(r.today.landed, 1);
});

// ── Started talking ─────────────────────────────────────────────────────────

test('counts a shopper as talking in the window their first message landed', () => {
  const r = agg({
    referrals: [ref('biz-1', '900', '2026-08-15T07:00:00.000Z', '2026-08-15T07:30:00.000Z')],
  });
  assert.equal(r.today.landed, 1);
  assert.equal(r.today.talking, 1);
});

test('a shopper who landed yesterday but first spoke today counts in each window separately', () => {
  const r = agg({
    referrals: [ref('biz-1', '900', '2026-08-14T10:00:00.000Z', '2026-08-15T08:00:00.000Z')],
  });
  assert.equal(r.yesterday.landed, 1);
  assert.equal(r.yesterday.talking, 0);
  assert.equal(r.today.landed, 0);
  assert.equal(r.today.talking, 1);
});

test('duplicate referral rows sharing one first_message_at count as one conversation', () => {
  // replyEngine stamps first_message_at on EVERY null row for the pair, so
  // duplicates all carry the same timestamp.
  const at = '2026-08-15T08:00:00.000Z';
  const r = agg({
    referrals: [
      ref('biz-1', '900', '2026-08-15T07:00:00.000Z', at),
      ref('biz-1', '900', '2026-08-15T07:05:00.000Z', at),
    ],
  });
  assert.equal(r.today.talking, 1);
});

test('a referral that never converted contributes no talking count', () => {
  const r = agg({ referrals: [ref('biz-1', '900', '2026-08-15T07:00:00.000Z', null)] });
  assert.equal(r.today.talking, 0);
});

// ── Orders and GMV from search-acquired customers ───────────────────────────

test('attributes an order placed by a customer who ever arrived via search', () => {
  const r = agg({
    attributedPairs: [{ business_id: 'biz-1', customer_telegram_id: '900' }],
    customers: [cust('cust-1', 'biz-1', '900')],
    orders: [order('cust-1', 'biz-1', 1200, 'paid', '2026-08-15T08:00:00.000Z')],
  });
  assert.equal(r.today.orders, 1);
  assert.equal(r.today.gmv_etb, 1200);
});

test('attribution is permanent — the referral can predate both windows', () => {
  // "Once from search, always from search": no referral row in the 2-day
  // window at all, but the pair is in the ever-attributed set.
  const r = agg({
    referrals: [],
    attributedPairs: [{ business_id: 'biz-1', customer_telegram_id: '900' }],
    customers: [cust('cust-1', 'biz-1', '900')],
    orders: [order('cust-1', 'biz-1', 500, 'paid', '2026-08-15T08:00:00.000Z')],
  });
  assert.equal(r.today.landed, 0);
  assert.equal(r.today.orders, 1);
  assert.equal(r.today.gmv_etb, 500);
});

test('excludes orders from customers who never arrived via search', () => {
  const r = agg({
    attributedPairs: [],
    customers: [cust('cust-1', 'biz-1', '900')],
    orders: [order('cust-1', 'biz-1', 9999, 'paid', '2026-08-15T08:00:00.000Z')],
  });
  assert.equal(r.today.orders, 0);
  assert.equal(r.today.gmv_etb, 0);
});

test('unpaid orders count toward orders but never toward GMV', () => {
  const r = agg({
    attributedPairs: [{ business_id: 'biz-1', customer_telegram_id: '900' }],
    customers: [cust('cust-1', 'biz-1', '900')],
    orders: [
      order('cust-1', 'biz-1', 1000, 'pending',   '2026-08-15T08:00:00.000Z'),
      order('cust-1', 'biz-1', 2000, 'paid',      '2026-08-15T08:10:00.000Z'),
      order('cust-1', 'biz-1', 3000, 'FULFILLED', '2026-08-15T08:20:00.000Z'),
      order('cust-1', 'biz-1',  400, 'cancelled', '2026-08-15T08:30:00.000Z'),
    ],
  });
  assert.equal(r.today.orders, 4);
  assert.equal(r.today.gmv_etb, 5000); // paid + fulfilled, case-insensitive
});

test('splits orders and GMV across the day boundary', () => {
  const r = agg({
    attributedPairs: [{ business_id: 'biz-1', customer_telegram_id: '900' }],
    customers: [cust('cust-1', 'biz-1', '900')],
    orders: [
      order('cust-1', 'biz-1', 700, 'paid', '2026-08-14T12:00:00.000Z'),
      order('cust-1', 'biz-1', 300, 'paid', '2026-08-15T08:00:00.000Z'),
    ],
  });
  assert.equal(r.yesterday.orders, 1);
  assert.equal(r.yesterday.gmv_etb, 700);
  assert.equal(r.today.orders, 1);
  assert.equal(r.today.gmv_etb, 300);
});

test('an order whose customer row is missing is ignored, not crashed on', () => {
  const r = agg({
    attributedPairs: [{ business_id: 'biz-1', customer_telegram_id: '900' }],
    customers: [],
    orders: [order('ghost', 'biz-1', 1000, 'paid', '2026-08-15T08:00:00.000Z')],
  });
  assert.equal(r.today.orders, 0);
  assert.equal(r.today.gmv_etb, 0);
});

test('attribution is per-business — a search lead at one shop does not credit another', () => {
  const r = agg({
    attributedPairs: [{ business_id: 'biz-1', customer_telegram_id: '900' }],
    customers: [cust('cust-2', 'biz-2', '900')], // same person, different shop
    orders: [order('cust-2', 'biz-2', 1000, 'paid', '2026-08-15T08:00:00.000Z')],
  });
  assert.equal(r.today.orders, 0);
});

test('a null or non-numeric total never poisons GMV', () => {
  const r = agg({
    attributedPairs: [{ business_id: 'biz-1', customer_telegram_id: '900' }],
    customers: [cust('cust-1', 'biz-1', '900')],
    orders: [
      order('cust-1', 'biz-1', null, 'paid', '2026-08-15T08:00:00.000Z'),
      order('cust-1', 'biz-1', 250,  'paid', '2026-08-15T08:05:00.000Z'),
    ],
  });
  assert.equal(r.today.gmv_etb, 250);
});

// ── Top receivers ───────────────────────────────────────────────────────────

test('ranks today\'s top receiving businesses by distinct arrivals', () => {
  const r = agg({
    referrals: [
      ref('biz-1', '900', '2026-08-15T07:00:00.000Z'),
      ref('biz-1', '901', '2026-08-15T07:01:00.000Z'),
      ref('biz-1', '901', '2026-08-15T07:02:00.000Z'), // dupe, must not inflate
      ref('biz-2', '902', '2026-08-15T07:03:00.000Z'),
      ref('biz-3', '903', '2026-08-14T07:03:00.000Z'), // yesterday, excluded
    ],
    businessNames: { 'biz-1': 'Abeba Coffee', 'biz-2': 'Selam Boutique', 'biz-3': 'Old Shop' },
  });
  assert.deepEqual(r.topReceivers, [
    { business_id: 'biz-1', name: 'Abeba Coffee', landed: 2 },
    { business_id: 'biz-2', name: 'Selam Boutique', landed: 1 },
  ]);
});

test('a deleted business never appears as a named receiver', () => {
  // Pulse's rule: no row may name a business that no longer exists.
  const r = agg({
    referrals: [
      ref('biz-gone', '900', '2026-08-15T07:00:00.000Z'),
      ref('biz-1', '901', '2026-08-15T07:01:00.000Z'),
    ],
    businessNames: { 'biz-1': 'Abeba Coffee' },
  });
  assert.deepEqual(r.topReceivers, [{ business_id: 'biz-1', name: 'Abeba Coffee', landed: 1 }]);
  // ...but the arrival itself still counts in the total.
  assert.equal(r.today.landed, 2);
});

test('caps top receivers at three', () => {
  const referrals = ['a', 'b', 'c', 'd', 'e'].map((b, i) =>
    ref(`biz-${b}`, `90${i}`, '2026-08-15T07:00:00.000Z'));
  const businessNames = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(b => [`biz-${b}`, `Shop ${b}`]));
  assert.equal(agg({ referrals, businessNames }).topReceivers.length, 3);
});

// ── Key helper ──────────────────────────────────────────────────────────────

test('pairKey normalizes both halves to strings', () => {
  assert.equal(pairKey('biz-1', 900), pairKey('biz-1', '900'));
  assert.notEqual(pairKey('biz-1', '900'), pairKey('biz-2', '900'));
});
