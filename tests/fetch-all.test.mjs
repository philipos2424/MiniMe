/**
 * Run: node --test tests/fetch-all.test.mjs
 * Guards the pagination helper that works around Supabase's 1000-row
 * response cap — the cap that was silently truncating every admin metric.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from '../apps/web/src/lib/server/fetch-all.mjs';

/** Fake PostgREST builder over `rows`, capping each response at `serverCap`. */
function fakeTable(rows, { serverCap = 1000, failOnPage = -1 } = {}) {
  let calls = 0;
  const makeQuery = () => ({
    range(from, to) {
      const page = calls++;
      if (page === failOnPage) return Promise.resolve({ data: null, error: { message: 'boom' } });
      const requested = to - from + 1;
      const data = rows.slice(from, from + Math.min(requested, serverCap));
      return Promise.resolve({ data, error: null });
    },
  });
  return { makeQuery, callCount: () => calls };
}

test('drains past the 1000-row server cap', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ i }));
  const t = fakeTable(rows);
  const { data, error } = await fetchAllRows(t.makeQuery);
  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.deepEqual(data[2499], { i: 2499 });
  assert.equal(t.callCount(), 3); // 1000 + 1000 + 500
});

test('single short page stops after one call', async () => {
  const t = fakeTable(Array.from({ length: 42 }, (_, i) => ({ i })));
  const { data } = await fetchAllRows(t.makeQuery);
  assert.equal(data.length, 42);
  assert.equal(t.callCount(), 1);
});

test('empty table returns empty data, no error', async () => {
  const { data, error } = await fetchAllRows(fakeTable([]).makeQuery);
  assert.deepEqual(data, []);
  assert.equal(error, null);
});

test('exact multiple of page size stops (one extra empty page)', async () => {
  const t = fakeTable(Array.from({ length: 2000 }, (_, i) => ({ i })));
  const { data } = await fetchAllRows(t.makeQuery);
  assert.equal(data.length, 2000);
});

test('respects maxRows ceiling', async () => {
  const t = fakeTable(Array.from({ length: 5000 }, (_, i) => ({ i })));
  const { data } = await fetchAllRows(t.makeQuery, { maxRows: 1500 });
  assert.equal(data.length, 1500);
});

test('propagates errors with rows collected so far', async () => {
  const t = fakeTable(Array.from({ length: 3000 }, (_, i) => ({ i })), { failOnPage: 1 });
  const { data, error } = await fetchAllRows(t.makeQuery);
  assert.equal(error.message, 'boom');
  assert.equal(data.length, 1000);
});

test('dayKeyEAT shifts UTC evening into next EAT day', () => {
  assert.equal(dayKeyEAT('2026-07-02T22:30:00Z'), '2026-07-03'); // 01:30 EAT
  assert.equal(dayKeyEAT('2026-07-02T12:00:00Z'), '2026-07-02');
  assert.equal(dayKeyEAT('not-a-date'), null);
});

test('lastNDaysEAT returns n consecutive keys ending today', () => {
  const now = Date.parse('2026-07-03T10:00:00Z');
  const days = lastNDaysEAT(3, now);
  assert.deepEqual(days, ['2026-07-01', '2026-07-02', '2026-07-03']);
});
