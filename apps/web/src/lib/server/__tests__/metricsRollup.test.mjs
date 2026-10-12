import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShopDailyRows, buildPlatformDailyRows, replyLatencies } from '../metrics/rollup.mjs';

const future = d => new Date(Date.now() + d * 86400000).toISOString();
const DAYS = ['2026-10-11', '2026-10-12'];
const TODAY = '2026-10-12';
const AT = '2026-10-13T00:00:00.000Z';
const A = { id: 'a', created_at: '2026-10-11T08:00:00Z', subscription_status: 'trial', trial_ends_at: future(10), owner_telegram_id: 1 };
const INTERNAL = { id: 'i', created_at: '2026-10-11T08:00:00Z', is_internal: true, owner_telegram_id: 9 };

const msgs = [
  { business_id: 'a', conversation_id: 'c1', customer_id: 'u1', direction: 'inbound',  status: 'sent',   created_at: '2026-10-12T06:00:00Z' },
  { business_id: 'a', conversation_id: 'c1', customer_id: 'u1', direction: 'inbound',  status: 'sent',   created_at: '2026-10-12T06:00:30Z' },
  { business_id: 'a', conversation_id: 'c1', customer_id: 'u1', direction: 'outbound', status: 'sent',   created_at: '2026-10-12T06:01:00Z', is_ai_generated: true },
  { business_id: 'a', conversation_id: 'c1', customer_id: 'u1', direction: 'outbound', status: 'failed', created_at: '2026-10-12T06:02:00Z' },
  { business_id: 'a', conversation_id: null, customer_id: 'u2', direction: 'inbound',  status: 'sent',   created_at: '2026-10-12T07:00:00Z' },
  { business_id: 'gone', conversation_id: 'c9', direction: 'inbound', status: 'sent', created_at: '2026-10-12T06:00:00Z' },
  { business_id: 'i', conversation_id: 'c8', direction: 'inbound', status: 'sent', created_at: '2026-10-12T06:00:00Z' },
];

const input = (over = {}) => ({
  days: DAYS, todayKey: TODAY, businesses: [A, INTERNAL], messages: msgs,
  customers: [{ business_id: 'a', first_contact_at: '2026-10-12T06:00:00Z' }],
  orders: [{ business_id: 'a', created_at: '2026-10-11T10:00:00Z', paid_at: '2026-10-12T09:00:00Z', total: '250.50' },
           { business_id: 'a', created_at: '2026-10-12T10:00:00Z', paid_at: '2026-10-12T11:00:00Z', refunded_at: '2026-10-12T12:00:00Z', total: '99' }],
  llmCalls: [{ business_id: 'a', route: 'reply', ok: false, total_cost_usd: '0.001', created_at: '2026-10-12T06:01:00Z' },
             { business_id: 'a', route: 'raw:openai', ok: false, total_cost_usd: '0.5', created_at: '2026-10-12T06:01:00Z' }],
  aiUsage: [{ user_id: 'a', tokens_used: 1200, created_at: '2026-10-12T06:01:00Z' }],
  uxEvents: [{ business_id: 'a', surface: 'dashboard', session_id: 's1', occurred_at: '2026-10-12T05:00:00Z' },
             { business_id: 'a', surface: 'dashboard', session_id: 's1', occurred_at: '2026-10-12T05:01:00Z' },
             { business_id: 'a', surface: 'market',    session_id: 's2', occurred_at: '2026-10-12T05:01:00Z' }],
  source: 'cron', computedAt: AT, ...over,
});

test('reply latency starts at the first inbound of a turn and ignores null conversations', () => {
  const l = replyLatencies(msgs);
  const a = l.filter(x => x.business_id === 'a');
  assert.equal(a.length, 1);
  assert.equal(a[0].latency_s, 60);
});

test('reply latency ignores an outbound with no preceding inbound', () => {
  assert.deepEqual(replyLatencies([{ business_id: 'a', conversation_id: 'c', direction: 'outbound', status: 'sent', created_at: '2026-10-12T06:00:00Z' }]), []);
});

test('shop rows: counts, exclusions, and today snapshot', () => {
  const rows = buildShopDailyRows(input());
  assert.ok(rows.every(r => r.business_id === 'a'), 'internal and unknown shops excluded');
  const d12 = rows.find(r => r.day === '2026-10-12');
  assert.equal(d12.inbound_messages, 3);
  assert.equal(d12.outbound_messages, 1);
  assert.equal(d12.failed_messages, 1);
  assert.equal(d12.ai_messages, 1);
  assert.equal(d12.customers_active, 2);
  assert.equal(d12.customers_new, 1);
  assert.equal(d12.orders_created, 1);
  assert.equal(d12.orders_paid, 1, 'refunded order not counted as paid');
  assert.equal(d12.paid_order_value_etb, 250.5);
  assert.equal(d12.first_reply_p50_s, 60);
  assert.equal(d12.owner_sessions, 1, 'distinct dashboard sessions only');
  assert.equal(d12.llm_calls, 1, 'raw rows excluded');
  assert.equal(d12.llm_failed, 1);
  assert.equal(d12.llm_cost_usd, 0.001);
  assert.equal(d12.ai_tokens, 1200);
  assert.equal(d12.plan_state, 'trial');
  assert.equal(d12.payment_state, 'trial');
  const d11 = rows.find(r => r.day === '2026-10-11');
  assert.equal(d11.orders_created, 1);
  assert.equal(d11.plan_state, null, 'state snapshot only on today');
});

test('no personal data in shop rows', () => {
  const keys = Object.keys(buildShopDailyRows(input())[0]);
  for (const bad of ['name', 'phone', 'telegram_id', 'owner_telegram_id', 'content', 'customer_id']) {
    assert.ok(!keys.includes(bad), `shop_daily must not carry ${bad}`);
  }
});

test('builders are deterministic', () => {
  assert.deepEqual(buildShopDailyRows(input()), buildShopDailyRows(input()));
});

test('empty activity still snapshots every external shop today', () => {
  const rows = buildShopDailyRows(input({ messages: [], customers: [], orders: [], llmCalls: [], aiUsage: [], uxEvents: [] }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].day, TODAY);
  assert.equal(rows[0].inbound_messages, 0);
  assert.equal(rows[0].plan_state, 'trial');
});

test('platform rows: totals, funnel, and a zero row for quiet days', () => {
  const shopRows = buildShopDailyRows(input());
  const rows = buildPlatformDailyRows({
    days: DAYS, shopRows, businesses: [A, INTERNAL],
    onboardingEvents: [
      { telegram_id: 1, step: 'welcome', created_at: '2026-10-11T08:00:00Z' },
      { telegram_id: 1, step: 'welcome', created_at: '2026-10-11T08:05:00Z' },
      { telegram_id: 2, step: 'connected_shared', created_at: '2026-10-11T09:00:00Z' },
      { telegram_id: 9, step: 'welcome', created_at: '2026-10-11T08:00:00Z' },
      { telegram_id: 3, step: 'tour_started', created_at: '2026-10-11T08:00:00Z' },
    ],
    subscriptionEvents: [{ business_id: 'a', event: 'trial_converted', created_at: '2026-10-12T10:00:00Z' },
                         { business_id: 'i', event: 'subscribed', created_at: '2026-10-12T10:00:00Z' }],
    source: 'cron', computedAt: AT,
  });
  assert.deepEqual(rows.map(r => r.day), DAYS);
  const [d11, d12] = rows;
  assert.equal(d11.signups, 1, 'internal signup excluded');
  assert.equal(d11.funnel.welcome, 1, 'distinct ids, internal owner excluded');
  assert.equal(d11.funnel.connected, 1);
  assert.equal(d11.live_shops, 0);
  assert.equal(d12.live_shops, 1);
  assert.equal(d12.engaged_owners, 1);
  assert.equal(d12.inbound_messages, 3);
  assert.equal(d12.trial_converted, 1);
  assert.equal(d12.subscribed, 0, 'internal subscription excluded');
});
