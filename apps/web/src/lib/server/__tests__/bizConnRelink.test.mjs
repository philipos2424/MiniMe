/**
 * Secretary messages on a business connection no shop had stored were
 * dropped ("no business for conn_id", ~100 in 25 minutes on 2026-10-17).
 * The relinker asks Telegram who owns the connection and links their shop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBizConnRelinker } from '../bizConnRelink.js';

function setup({ conn = { ok: true, result: { id: 'c1', user: { id: 42 }, is_enabled: true } }, shop = { id: 'b1', name: 'Shop' } } = {}) {
  const calls = { get: 0, find: [], store: [] };
  let t = 1000;
  const relink = makeBizConnRelinker({
    getConnection: async () => { calls.get++; return typeof conn === 'function' ? conn() : conn; },
    findOwnerBusiness: async (id) => { calls.find.push(id); return shop; },
    storeConnId: async (bizId, connId) => { calls.store.push([bizId, connId]); },
    now: () => t,
    negativeTtlMs: 500,
  });
  return { relink, calls, advance: (ms) => { t += ms; } };
}

test('an unknown connection is linked to its owner\'s shop', async () => {
  const { relink, calls } = setup();
  const biz = await relink('c1');
  assert.equal(biz.id, 'b1');
  assert.equal(biz.telegram_biz_conn_id, 'c1');
  assert.deepEqual(calls.find, ['42']);
  assert.deepEqual(calls.store, [['b1', 'c1']]);
});

test('an owner with no shop is not linked, and is not re-asked within the TTL', async () => {
  const { relink, calls, advance } = setup({ shop: null });
  assert.equal(await relink('c1'), null);
  assert.equal(await relink('c1'), null);
  assert.equal(calls.get, 1, 'second message served from the negative cache');
  advance(600);
  await relink('c1');
  assert.equal(calls.get, 2, 'asked again after the TTL, so a shop created later gets linked');
  assert.deepEqual(calls.store, []);
});

test('a disabled connection is never relinked', async () => {
  const { relink, calls } = setup({ conn: { ok: true, result: { id: 'c1', user: { id: 42 }, is_enabled: false } } });
  assert.equal(await relink('c1'), null);
  assert.deepEqual(calls.find, []);
  assert.deepEqual(calls.store, []);
});

test('a Telegram failure is not cached, so the next message retries', async () => {
  let n = 0;
  const { relink, calls } = setup({ conn: () => (++n === 1 ? { ok: false, description: 'timeout' } : { ok: true, result: { user: { id: 42 }, is_enabled: true } }) });
  assert.equal(await relink('c1'), null);
  const biz = await relink('c1');
  assert.equal(biz?.id, 'b1');
  assert.equal(calls.get, 2);
});

test('no connection id means no Telegram call', async () => {
  const { relink, calls } = setup();
  assert.equal(await relink(undefined), null);
  assert.equal(calls.get, 0);
});

test('the agent-bot falls back to the relinker before dropping a business message', () => {
  const route = readFileSync(new URL('../../../app/api/agent-bot/webhook/route.js', import.meta.url), 'utf8');
  const at = route.indexOf('(await findByBizConnId(connId))');
  assert.ok(at > 0, 'lookup by connection id present');
  const block = route.slice(at, route.indexOf("console.warn('[agent-bot] no business for conn_id:'", at));
  assert.match(block, /relinkBizConn\(connId\)/);
});
