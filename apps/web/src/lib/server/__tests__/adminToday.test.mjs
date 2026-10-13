import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rollupFreshness, countTodaySignups, liveShopCount, aiOutcomes, webhookOutcomes, pendingReviewCount } from '../metrics/definitions.mjs';
import { readRollupFreshness, rollupPulseAlert } from '../metrics/freshness.mjs';
import { loadTodayPanel, TODAY_PANELS } from '../metrics/today.mjs';

const now = Date.parse('2026-10-13T06:00:00Z');
const businesses = [
  { id: 'external', created_at: '2026-10-12T21:00:00Z', subscription_status: 'pending_review', owner_telegram_id: '999999999', owner_name: 'Private Person', phone: '+251911234567' },
  { id: 'internal', is_internal: true, created_at: '2026-10-13T01:00:00Z', subscription_status: 'pending_review' },
];

function db(tables = {}, failures = []) {
  const reads = [];
  return { reads, from(table) {
    const filters = [], orders = [];
    let first = 0, last = Infinity;
    const q = {
      select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
      gte(k, v) { filters.push(r => r[k] >= v); return q; },
      lt(k, v) { filters.push(r => r[k] < v); return q; },
      not(k, op, v) { filters.push(r => r[k] != v); return q; },
      order(k, opts = {}) { orders.push([k, opts.ascending !== false]); return q; },
      limit(n) { last = n - 1; return q; },
      range(a, b) { first = a; last = b; return q; },
      maybeSingle() { return result(true); },
      then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
    };
    function result(single) {
      reads.push({ table, first, orders });
      if (failures.includes(table)) return { data: null, error: { message: 'private database error +251911234567' } };
      let rows = (tables[table] || []).filter(r => filters.every(f => f(r)));
      rows.sort((a, b) => { for (const [k, asc] of orders) { if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (asc ? 1 : -1); } return 0; });
      rows = rows.slice(first, last + 1);
      return { data: single ? rows[0] || null : rows, error: null };
    }
    return q;
  } };
}

test('freshness handles missing, invalid, future, threshold and stale timestamps', () => {
  for (const ts of [null, 'bad', new Date(now + 1).toISOString()]) assert.equal(rollupFreshness(ts, now).stale, true);
  assert.equal(rollupFreshness(new Date(now - 26 * 3600000).toISOString(), now).stale, false);
  assert.equal(rollupFreshness(new Date(now - 26 * 3600000 - 1).toISOString(), now).stale, true);
  assert.equal(rollupPulseAlert(rollupFreshness(null, now)).type, 'stale_rollup');
});

test('latest successful run ignores newer failed or unfinished runs', async () => {
  const sb = db({ metrics_rollup_runs: [
    { id: 1, ok: true, finished_at: '2026-10-12T23:00:00Z' },
    { id: 2, ok: false, finished_at: '2026-10-13T04:00:00Z' },
    { id: 3, ok: true, finished_at: null },
  ] });
  const value = await readRollupFreshness(sb, now);
  assert.equal(value.data_as_of, '2026-10-12T23:00:00.000Z');
  assert.equal(rollupPulseAlert(value), null);
  assert.equal(rollupPulseAlert(await readRollupFreshness(db({}, ['metrics_rollup_runs']), now)).type, 'rollup_unavailable');
});

test('Today definitions exclude internal and deleted shops, raw attempts and summaries', () => {
  assert.equal(countTodaySignups(businesses, now), 1);
  assert.equal(countTodaySignups([...businesses, { id: 'old', created_at: '2026-10-12T20:59:59Z' }], now), 1);
  assert.equal(pendingReviewCount(businesses), 1);
  const rows = [
    { business_id: 'external', direction: 'inbound', route: 'reply', ok: false, delivery_status: 'failure' },
    { business_id: 'external', direction: 'outbound', route: 'raw:groq', ok: false },
    { business_id: 'internal', direction: 'inbound', route: 'reply', ok: false, delivery_status: 'failure' },
    { business_id: 'deleted', direction: 'inbound', route: 'reply', ok: false },
    { business_id: 'external', route: '__daily_summary__', ok: false },
    { business_id: 'external', route: 'reply', ok: true, delivery_status: 'success' },
  ];
  assert.equal(liveShopCount(businesses, rows), 1);
  assert.deepEqual(aiOutcomes(businesses, rows), { calls: 2, failed: 1, failure_pct: 50 });
  assert.deepEqual(aiOutcomes(businesses, []), { calls: 0, failed: 0, failure_pct: null });
  assert.deepEqual(webhookOutcomes(businesses, rows), { deliveries: 2, failed: 1, affected_shops: 1 });
});

test('panel loader paginates, uses stable order and returns only aggregates', async () => {
  const sb = db({ businesses, messages: Array.from({ length: 1001 }, (_, id) => ({ id, business_id: 'external', direction: 'inbound', created_at: '2026-10-13T05:00:00Z', text: 'secret message' })) });
  for (const panel of TODAY_PANELS) {
    const payload = await loadTodayPanel(sb, panel, now);
    const json = JSON.stringify(payload);
    for (const privateValue of ['999999999', '+251911234567', 'Private Person', 'secret message', 'owner_telegram_id']) assert.ok(!json.includes(privateValue));
  }
  assert.ok(sb.reads.some(r => r.table === 'messages' && r.first === 1000));
  assert.ok(sb.reads.every(r => r.orders.length));
});

test('failed reads do not become healthy zeroes and independent panels still load', async () => {
  const sb = db({ businesses }, ['messages']);
  await assert.rejects(loadTodayPanel(sb, 'activity', now));
  assert.equal((await loadTodayPanel(sb, 'payments', now)).count, 1);
  await assert.rejects(loadTodayPanel(sb, 'anything', now));
  const signups = await loadTodayPanel(sb, 'signups', now);
  assert.equal(signups.previous, null);
  assert.equal(signups.count, 1);
});

test('v2 route guards auth and disables caching; legacy Pulse uses shared freshness', () => {
  const route = readFileSync(new URL('../../../app/api/admin/v2/today/route.js', import.meta.url), 'utf8');
  assert.ok(route.indexOf('await requireAdminRequest(request)') < route.indexOf('supabase()'));
  assert.match(route, /status: 403/);
  assert.match(route, /no-store/);
  const pulse = readFileSync(new URL('../../../app/api/admin/pulse/route.js', import.meta.url), 'utf8');
  assert.match(pulse, /rollupPulseAlert/);
});

function routeHandler({ authorized = true, loader = loadTodayPanel, database = db() } = {}) {
  const source = readFileSync(new URL('../../../app/api/admin/v2/today/route.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/export const /g, 'const ').replace('export async function GET', 'async function GET');
  return new Function('NextResponse', 'requireAdminRequest', 'supabase', 'loadTodayPanel', 'TODAY_PANELS', source + '; return GET;')(
    { json: (body, options = {}) => ({ body, status: options.status || 200, headers: options.headers }) },
    async () => authorized ? { id: 1 } : null, () => database, loader, TODAY_PANELS,
  );
}

test('route refuses anonymous requests before querying and rejects unknown panels', async () => {
  let accessed = false;
  const handler = routeHandler({ authorized: false, loader: async () => { accessed = true; } });
  const result = await handler(new Request('http://localhost/api/admin/v2/today?panel=payments'));
  assert.equal(result.status, 403);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(accessed, false);
  assert.equal((await routeHandler()(new Request('http://localhost/api/admin/v2/today?panel=unknown'))).status, 400);
});

test('route isolates panel errors and never returns database error text', async () => {
  const handler = routeHandler({ loader: async (sb, panel) => {
    if (panel === 'ai') throw new Error('secret database detail +251911234567');
    return { count: 3 };
  } });
  const result = await handler(new Request('http://localhost/api/admin/v2/today'));
  assert.equal(result.body.panels.payments.data.count, 3);
  assert.ok(result.body.panels.ai.error);
  assert.ok(!JSON.stringify(result).includes('secret database'));
  assert.equal((await handler(new Request('http://localhost/api/admin/v2/today?panel=ai'))).status, 503);
});
