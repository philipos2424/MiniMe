import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../../app/api/home/feed/route.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '');
const load = new Function('NextResponse', 'verifyTelegramInitData', 'parseTelegramUser', 'findBusinessForUser', 'supabase',
  source.replace(/export const /g, 'const ').replace('export async function GET', 'async function GET') + '; return GET;');

test('home counts sent replies, retains fulfilled revenue, and exposes query failure', async () => {
  let fail = false;
  const timestamp = new Date().toISOString();
  const data = {
    messages: [
      { business_id: 'shop', direction: 'outbound', is_ai_generated: true, status: 'sent', created_at: timestamp },
      { business_id: 'shop', direction: 'outbound', is_ai_generated: true, status: 'failed', created_at: timestamp },
      { business_id: 'other', direction: 'outbound', is_ai_generated: true, status: 'sent', created_at: timestamp },
    ],
    orders: [
      { business_id: 'shop', status: 'paid', total: 10, currency: 'USD', paid_at: timestamp },
      { business_id: 'shop', status: 'fulfilled', total: 20, currency: 'USD', paid_at: timestamp },
      { business_id: 'shop', status: 'pending_payment', total: 90, currency: 'USD', paid_at: timestamp },
    ],
  };
  const db = { from(table) {
    let rows = data[table] || [];
    const query = {
      select() { return query; },
      eq(key, value) { rows = rows.filter(r => r[key] === value); return query; },
      in(key, values) { rows = rows.filter(r => values.includes(r[key])); return query; },
      gte(key, value) { rows = rows.filter(r => r[key] >= value); return query; },
      order() { return query; }, limit() { return query; }, maybeSingle() { return query; },
      then(resolve) { return Promise.resolve({ data: rows, count: rows.length, error: fail && table === 'orders' ? { message: 'fixture outage' } : null }).then(resolve); },
    };
    return query;
  } };
  const GET = load({ json: (body, opts) => ({ body, status: opts?.status || 200 }) }, () => true, () => ({ id: 1 }), async () => ({ id: 'shop' }), () => db);
  const request = { headers: { get: () => 'fixture' } };
  const response = await GET(request);
  assert.equal(response.status, 200);
  assert.equal(response.body.handled_today, 1);
  assert.equal(response.body.weekly_ai_chats, 1);
  assert.equal(response.body.orders_today, 2);
  assert.equal(response.body.revenue_today, 30);
  assert.equal(response.body.revenue_currency, 'USD');
  fail = true;
  assert.equal((await GET(request)).status, 503, 'outage must not become zero activity');
});
