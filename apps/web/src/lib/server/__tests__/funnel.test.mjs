import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRealCustomer, realInboundMessages, conversationsOf, activationTime, FUNNEL_STEPS,
} from '../funnel/events.mjs';
import { deriveFunnelEvents, newEvents, onboardedAt } from '../funnel/derive.mjs';
import { buildWeeklyReport, formatWeeklyReport, eatMondayStart } from '../funnel/weeklyReport.mjs';

const OWNER = 100, SUBADMIN = 101, ADMIN = 999;
const SHOP = {
  id: 'a', name: 'Abeba <Shoes>', created_at: '2026-10-01T08:00:00Z', owner_telegram_id: OWNER,
  sub_admin_telegram_ids: [SUBADMIN], onboarding_completed: true, onboarding_completed_at: '2026-10-02T08:00:00Z',
};
const TEST_SHOP = { id: 'i', name: 'Founder test', created_at: '2026-10-01T08:00:00Z', owner_telegram_id: 7, is_internal: true, onboarding_completed: true, onboarding_completed_at: '2026-10-02T08:00:00Z' };
const cust = (id, telegram_id, business_id = 'a') => ({ id, business_id, telegram_id });
const msg = (customer_id, created_at, business_id = 'a') => ({ business_id, customer_id, direction: 'inbound', created_at });
const only = (rows, event) => rows.filter(r => r.event === event);

// ── real-customer rule ───────────────────────────────────────────────────────

test('owner, sub-admin and platform admin are not real customers', () => {
  assert.equal(isRealCustomer(SHOP, cust('o', OWNER), [ADMIN]), false);
  assert.equal(isRealCustomer(SHOP, cust('s', String(SUBADMIN)), [ADMIN]), false);
  assert.equal(isRealCustomer(SHOP, cust('p', ADMIN), [String(ADMIN)]), false);
  assert.equal(isRealCustomer(SHOP, cust('c', 555), [ADMIN]), true);
});

test('a customer without a telegram id (WhatsApp/Instagram) is real; test shops have none', () => {
  assert.equal(isRealCustomer(SHOP, cust('w', null), [ADMIN]), true);
  assert.equal(isRealCustomer(TEST_SHOP, cust('c', 555), []), false);
});

test('realInboundMessages drops owner tests, outbound and test-shop traffic', () => {
  const out = realInboundMessages({
    businesses: [SHOP, TEST_SHOP],
    customers: [cust('o', OWNER), cust('c', 555), cust('x', 556, 'i')],
    messages: [
      msg('o', '2026-10-03T08:00:00Z'),
      msg('c', '2026-10-03T09:00:00Z'),
      { ...msg('c', '2026-10-03T09:01:00Z'), direction: 'outbound' },
      msg('x', '2026-10-03T09:00:00Z', 'i'),
      msg('c', '2026-10-03T09:00:00Z', 'deleted-shop'),
    ],
    adminIds: [],
  });
  assert.deepEqual(out.map(m => m.customer_id), ['c']);
});

// ── conversation = one customer, 24-hour window ──────────────────────────────

test('messages inside 24h are one conversation; the next message opens a new one', () => {
  const convs = conversationsOf([
    msg('c', '2026-10-03T09:00:00Z'),
    msg('c', '2026-10-03T20:00:00Z'),
    msg('c', '2026-10-04T08:59:59Z'),
    msg('c', '2026-10-04T09:00:00Z'),
    msg('d', '2026-10-03T09:30:00Z'),
  ]);
  assert.equal(convs.length, 3);
  assert.deepEqual(convs.map(c => [c.customer_key, c.messages]), [['c', 3], ['d', 1], ['c', 1]]);
});

test('conversations are per shop, and unattributable messages are skipped', () => {
  const convs = conversationsOf([
    msg('c', '2026-10-03T09:00:00Z', 'a'),
    msg('c', '2026-10-03T09:05:00Z', 'b'),
    { business_id: 'a', created_at: '2026-10-03T09:00:00Z' },
    { business_id: 'a', conversation_id: 'conv1', created_at: '2026-10-03T09:00:00Z' },
  ]);
  assert.equal(convs.length, 3);
});

// ── activation = 3 conversations within 7 days of onboarding ─────────────────

test('activates at the start of the third conversation', () => {
  const at = activationTime('2026-10-02T08:00:00Z', [
    msg('c', '2026-10-03T09:00:00Z'), msg('d', '2026-10-04T09:00:00Z'), msg('e', '2026-10-05T10:00:00Z'), msg('f', '2026-10-06T10:00:00Z'),
  ]);
  assert.equal(at, '2026-10-05T10:00:00Z');
});

test('two conversations, or a third after day 7, or ones before onboarding, do not activate', () => {
  const T = '2026-10-02T08:00:00Z';
  assert.equal(activationTime(T, [msg('c', '2026-10-03T09:00:00Z'), msg('d', '2026-10-04T09:00:00Z')]), null);
  assert.equal(activationTime(T, [msg('c', '2026-10-03T09:00:00Z'), msg('d', '2026-10-04T09:00:00Z'), msg('e', '2026-10-09T08:00:01Z')]), null);
  assert.equal(activationTime(T, [msg('c', '2026-10-01T09:00:00Z'), msg('d', '2026-10-03T09:00:00Z'), msg('e', '2026-10-04T09:00:00Z')]), null);
});

// ── deriving events ──────────────────────────────────────────────────────────

const baseInput = (over = {}) => ({
  businesses: [SHOP, TEST_SHOP],
  customers: [cust('o', OWNER), cust('c', 555), cust('d', 556), cust('e', 557), cust('x', 600, 'i')],
  messages: [
    msg('o', '2026-10-02T09:00:00Z'),
    msg('c', '2026-10-03T09:00:00Z'), msg('d', '2026-10-04T09:00:00Z'), msg('e', '2026-10-05T10:00:00Z'),
    msg('x', '2026-10-03T09:00:00Z', 'i'),
  ],
  adminIds: [ADMIN],
  ...over,
});

test('derives the lifecycle for a real shop and nothing for a test shop', () => {
  const rows = deriveFunnelEvents(baseInput());
  assert.equal(rows.some(r => r.business_id === 'i'), false);
  assert.equal(only(rows, 'registered')[0].occurred_at, '2026-10-01T08:00:00.000Z');
  assert.deepEqual(only(rows, 'onboarding_completed')[0].metadata, {});
  // The owner's own test message at 10-02 is not the first customer message.
  assert.equal(only(rows, 'first_customer_message')[0].occurred_at, '2026-10-03T09:00:00.000Z');
  assert.equal(only(rows, 'activated')[0].occurred_at, '2026-10-05T10:00:00.000Z');
});

test('onboarding time falls back, and says it is approximate', () => {
  const old = { ...SHOP, onboarding_completed_at: null, trial_started_at: '2026-10-02T12:00:00Z' };
  assert.deepEqual(onboardedAt(old, '2026-10-02T10:00:00Z'), { at: '2026-10-02T10:00:00Z', basis: 'onboarding_events' });
  assert.deepEqual(onboardedAt(old, undefined), { at: '2026-10-02T12:00:00Z', basis: 'trial_started_at' });
  assert.equal(onboardedAt({ ...SHOP, onboarding_completed: false }), null);

  const rows = deriveFunnelEvents(baseInput({
    businesses: [old],
    onboardingEvents: [{ telegram_id: String(OWNER), step: 'connected_shared', created_at: '2026-10-02T10:00:00Z' }],
  }));
  assert.deepEqual(only(rows, 'onboarding_completed')[0].metadata, { approximate: true, basis: 'onboarding_events' });
});

test('a windowed sync does not judge activation for shops onboarded before the window', () => {
  const rows = deriveFunnelEvents(baseInput({ messagesSince: '2026-10-03T00:00:00Z' }));
  assert.equal(only(rows, 'activated').length, 0);
  assert.equal(only(deriveFunnelEvents(baseInput({ messagesSince: '2026-10-02T00:00:00Z' })), 'activated').length, 1);
});

test('only real payments confirm; grants do not; churn needs a prior payment', () => {
  const se = (id, event, created_at, source) => ({ id, business_id: 'a', event, created_at, plan: 'pro_monthly', amount_etb: 499, meta: source ? { source } : null });
  const rows = deriveFunnelEvents(baseInput({
    subscriptionEvents: [
      se('1', 'trial_started', '2026-10-02T08:00:00Z', 'admin_edit'),
      se('2', 'expired', '2026-10-09T08:00:00Z'),                    // trial lapsing — not churn
      se('3', 'trial_converted', '2026-10-10T08:00:00Z', 'bulk_activate'),
      se('4', 'subscribed', '2026-10-11T08:00:00Z', 'admin_edit'),   // grant
      se('5', 'subscribed', '2026-10-12T08:00:00Z', 'admin_review'), // real
      se('6', 'renewed', '2026-11-12T08:00:00Z', 'chapa'),
      se('7', 'churned', '2026-11-20T08:00:00Z', 'admin_review'),    // rejected receipt — not churn
      se('8', 'churned', '2026-12-12T08:00:00Z', 'admin_edit'),
      { ...se('9', 'subscribed', '2026-10-12T08:00:00Z', 'verify.et'), business_id: 'i' },
    ],
  }));
  assert.deepEqual(only(rows, 'payment_confirmed').map(r => r.dedupe_key), ['se:5']);
  assert.equal(only(rows, 'payment_confirmed')[0].metadata.amount_etb, 499);
  assert.deepEqual(only(rows, 'subscription_renewed').map(r => r.dedupe_key), ['se:6']);
  assert.deepEqual(only(rows, 'churned').map(r => r.dedupe_key), ['se:8']);
  assert.equal(only(rows, 'trial_started').length, 1);
});

test('one payment_submitted per receipt reference, earliest time wins', () => {
  const pv = (id, our_reference, created_at) => ({ id, business_id: 'a', method: 'telebirr', our_reference, bank_reference: 'B1', created_at });
  const rows = deriveFunnelEvents(baseInput({
    paymentVerifications: [pv('1', 'SUB-1', '2026-10-10T08:05:00Z'), pv('2', 'SUB-1', '2026-10-10T08:00:00Z'), pv('3', 'SUB-2', '2026-10-11T08:00:00Z')],
  }));
  const sub = only(rows, 'payment_submitted');
  assert.deepEqual(sub.map(r => r.dedupe_key).sort(), ['ref:SUB-1', 'ref:SUB-2']);
  assert.equal(sub.find(r => r.dedupe_key === 'ref:SUB-1').occurred_at, '2026-10-10T08:00:00.000Z');
});

test('legacy receipt rows are backfill-only and never duplicate a recorded submission', () => {
  const withProof = { ...SHOP, payment_proof_url: 'https://x/p.jpg', updated_at: '2026-10-15T08:00:00Z' };
  assert.equal(only(deriveFunnelEvents(baseInput({ businesses: [withProof] })), 'payment_submitted').length, 0);
  const rows = deriveFunnelEvents(baseInput({ businesses: [withProof], source: 'backfill' }));
  const legacy = only(rows, 'payment_submitted');
  assert.equal(legacy[0].dedupe_key, 'legacy');
  assert.equal(legacy[0].metadata.approximate, true);
  const existing = [{ business_id: 'a', event: 'payment_submitted', dedupe_key: 'ref:SUB-9' }];
  assert.equal(only(newEvents(rows, existing), 'payment_submitted').length, 0);
});

test('syncing twice inserts nothing new', () => {
  const rows = deriveFunnelEvents(baseInput());
  assert.equal(newEvents(rows, []).length, rows.length);
  assert.equal(newEvents(rows, rows).length, 0);
  assert.equal(newEvents([...rows, ...rows], []).length, rows.length);
});

// ── weekly report ────────────────────────────────────────────────────────────

// Monday 2026-11-09 09:00 Addis = 06:00 UTC. Reported week: Nov 2–8 (Addis).
const NOW = Date.parse('2026-11-09T06:00:00Z');

test('the reported week is the last completed Mon–Sun week in Addis time', () => {
  assert.equal(new Date(eatMondayStart(NOW)).toISOString(), '2026-11-08T21:00:00.000Z');
  // Sunday 23:30 Addis still belongs to the week that has not finished.
  assert.equal(new Date(eatMondayStart(Date.parse('2026-11-08T20:30:00Z'))).toISOString(), '2026-11-01T21:00:00.000Z');
});

const B = (id, name, extra = {}) => ({ id, name, owner_telegram_id: Number(`9${id.charCodeAt(0)}`), created_at: '2026-10-01T00:00:00Z', ...extra });
const ev = (business_id, event, occurred_at, metadata = {}) => ({ business_id, event, occurred_at, dedupe_key: '', metadata });

function reportInput() {
  const businesses = [B('a', 'Big <Shop>'), B('b', 'Small Shop'), B('c', 'Quiet Shop'), B('t', 'Test', { is_internal: true })];
  const customers = [
    cust('a1', 1, 'a'), cust('a2', 2, 'a'), cust('a3', 3, 'a'),
    cust('b1', 1, 'b'),                      // same person as a1
    cust('b2', null, 'b'),                   // WhatsApp
    cust('t1', 50, 't'),
    cust('ao', businesses[0].owner_telegram_id, 'a'),
  ];
  const messages = [
    msg('a1', '2026-11-03T08:00:00Z', 'a'), msg('a1', '2026-11-03T09:00:00Z', 'a'),
    msg('a2', '2026-11-04T08:00:00Z', 'a'), msg('a3', '2026-11-05T08:00:00Z', 'a'),
    msg('b1', '2026-11-06T08:00:00Z', 'b'),
    msg('ao', '2026-11-06T08:00:00Z', 'a'),  // owner testing
    msg('t1', '2026-11-06T08:00:00Z', 't'),  // test shop
    msg('b1', '2026-10-28T08:00:00Z', 'b'),  // previous week
  ];
  const events = [
    ev('a', 'registered', '2026-10-01T00:00:00Z'), ev('b', 'registered', '2026-11-03T00:00:00Z'),
    ev('c', 'registered', '2026-11-04T00:00:00Z'), ev('t', 'registered', '2026-11-04T00:00:00Z'),
    ev('a', 'onboarding_completed', '2026-10-02T00:00:00Z'), ev('b', 'onboarding_completed', '2026-11-03T06:00:00Z'),
    ev('c', 'onboarding_completed', '2026-11-05T06:00:00Z', { approximate: true }),
    ev('a', 'first_customer_message', '2026-10-03T00:00:00Z'), ev('b', 'first_customer_message', '2026-10-28T08:00:00Z'),
    ev('a', 'payment_submitted', '2026-11-04T00:00:00Z'), ev('b', 'payment_submitted', '2026-11-05T00:00:00Z'),
    ev('a', 'payment_confirmed', '2026-11-05T00:00:00Z'), ev('t', 'payment_confirmed', '2026-11-05T00:00:00Z'),
  ];
  return { businesses, customers, messages, events, adminIds: [], now: NOW };
}

test('report counts steps per week with conversion, excluding test shops', () => {
  const r = buildWeeklyReport(reportInput());
  const step = e => r.steps.find(s => s.event === e);
  assert.deepEqual(r.steps.map(s => s.event), FUNNEL_STEPS);
  assert.equal(step('registered').this_week, 2);
  assert.equal(step('registered').all_time, 3);
  assert.equal(step('onboarding_completed').this_week, 2);
  assert.equal(step('onboarding_completed').pct_this_week, 100);
  assert.equal(step('first_customer_message').all_time, 2);
  assert.equal(step('first_customer_message').pct_all_time, 67);
  assert.equal(step('registered').pct_this_week, null);
  assert.equal(r.shops.internal_excluded, 1);
});

test('only confirmed payments count as paying — a submitted receipt or a test shop does not', () => {
  const r = buildWeeklyReport(reportInput());
  assert.equal(r.paying_shops, 1);
  assert.equal(r.steps.find(s => s.event === 'payment_submitted').this_week, 2);
});

test('top shops, conversation totals and concentration use real conversations only', () => {
  const r = buildWeeklyReport(reportInput());
  assert.deepEqual(r.top_shops.map(s => [s.name, s.conversations, s.customers]), [['Big <Shop>', 3, 3], ['Small Shop', 1, 1]]);
  assert.deepEqual(r.conversations, { this_week: 4, last_week: 1, last_30_days: 5 });
  assert.equal(r.concentration.this_week.pct, 75);
  assert.equal(r.concentration.this_week.business_id, 'a');
  assert.equal(r.concentration.last_30_days.pct, 60);
});

test('lists shops that onboarded but never got a customer message', () => {
  const r = buildWeeklyReport(reportInput());
  assert.equal(r.never_messaged.count, 1);
  assert.deepEqual(r.never_messaged.shops[0], { business_id: 'c', name: 'Quiet Shop', onboarded_at: '2026-11-05T06:00:00Z', approximate: true });
});

test('the same Telegram user at two shops is one person, two records', () => {
  const r = buildWeeklyReport(reportInput());
  // a1,a2,a3,b1,b2 are real records; a1 and b1 are the same person.
  assert.deepEqual(r.customers, { records: 5, unique_people: 4 });
});

test('an empty platform produces a report, not a crash', () => {
  const r = buildWeeklyReport({ now: NOW });
  assert.equal(r.paying_shops, 0);
  assert.equal(r.concentration.this_week.pct, null);
  assert.ok(formatWeeklyReport(r).includes('Weekly funnel'));
});

test('Telegram text is bilingual, escapes shop names and fits one message', () => {
  const text = formatWeeklyReport(buildWeeklyReport(reportInput()), { webUrl: 'https://example.test' });
  assert.ok(text.includes('ሳምንታዊ'));
  assert.ok(text.includes('Paying shops (confirmed only): <b>1</b>'));
  assert.ok(text.includes('Big &lt;Shop&gt;'));
  assert.ok(!text.includes('Big <Shop>'));
  assert.ok(text.includes('= <b>75%</b>'));
  assert.ok(text.length < 4096);
});
