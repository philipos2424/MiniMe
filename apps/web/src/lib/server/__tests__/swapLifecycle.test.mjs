/**
 * Dead listings are what make a used-goods board feel abandoned, and nobody is
 * going to moderate this by hand. So the board prunes itself: ask once before
 * expiring, ask once about completion, then go quiet.
 *
 * "Once" is the load-bearing word in both cases. A bot that re-asks every day
 * whether you sold your phone gets muted, and a muted bot cannot run the rest
 * of this feature either.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSwapLifecycle, expiryPrompt, completionPrompt } from '../swap/swapLifecycle.mjs';

const DAY = 86400000;
const NOW = new Date('2026-09-02T06:00:00Z').getTime();

/**
 * The real column set on swap_items, from packages/db/migrations/050_swap.sql.
 * Notably absent: chat_id — that column lives on swap_reports, not
 * swap_items. A `select()` naming a column outside this set throws, so a
 * future edit to COLS that invents a column (the exact class of bug this
 * module shipped with once already) fails loudly here instead of silently
 * passing every test while breaking every production cron run.
 */
const SWAP_ITEMS_COLUMNS = new Set([
  'id', 'telegram_user_id', 'telegram_username', 'title', 'wants_text', 'condition',
  'area', 'area_is_freetext', 'photo_file_ids', 'category', 'keywords', 'want_category',
  'want_keywords', 'lang', 'status', 'view_count', 'interest_count', 'first_reveal_at',
  'completion_asked_at', 'expiry_asked_at', 'expires_at', 'created_at',
]);

function assertKnownColumns(cols) {
  if (typeof cols !== 'string') return;
  for (const raw of cols.split(',')) {
    const name = raw.trim();
    if (name === '' || name === '*') continue;
    if (!SWAP_ITEMS_COLUMNS.has(name)) {
      throw new Error(`fakeSb: select() named "${name}", which is not a column on swap_items (see packages/db/migrations/050_swap.sql)`);
    }
  }
}

/**
 * Fake holding one table of rows, supporting the filter chain the module uses
 * and recording updates. `failUpdateIds` lets a test make specific rows'
 * updates reject, to exercise per-item failure isolation.
 */
function fakeSb(rows, { failUpdateIds = new Set() } = {}) {
  const updates = [];
  const makeQuery = (filters = []) => {
    const q = {
      select: () => q,
      eq: (col, val) => makeQuery([...filters, r => String(r[col]) === String(val)]),
      lte: (col, val) => makeQuery([...filters, r => r[col] && new Date(r[col]) <= new Date(val)]),
      lt: (col, val) => makeQuery([...filters, r => r[col] && new Date(r[col]) < new Date(val)]),
      is: (col, val) => makeQuery([...filters, r => (r[col] ?? null) === val]),
      not: (col, _op, val) => makeQuery([...filters, r => (r[col] ?? null) !== val]),
      limit: () => q,
      then: (resolve) => resolve({ data: rows.filter(r => filters.every(f => f(r))), error: null }),
    };
    return q;
  };
  return {
    updates,
    from: () => ({
      select: (cols) => { assertKnownColumns(cols); return makeQuery(); },
      update: (patch) => ({
        eq: async (_c, id) => {
          if (failUpdateIds.has(id)) throw new Error('update failed');
          updates.push({ id, patch });
          return { error: null };
        },
      }),
    }),
  };
}

const base = {
  id: 'i1', title: 'Redmi Note 10', telegram_user_id: 42, chat_id: 42, lang: 'en',
  status: 'active', first_reveal_at: null, completion_asked_at: null, expiry_asked_at: null,
  expires_at: new Date(NOW + 10 * DAY).toISOString(),
};

test('an item near expiry is asked once, and marked as asked', async () => {
  const rows = [{ ...base, expires_at: new Date(NOW + 3600_000).toISOString() }];
  const sent = [];
  const sb = fakeSb(rows);
  const r = await runSwapLifecycle(sb, { send: async (m) => sent.push(m), now: NOW });

  assert.equal(r.expiryAsked, 1);
  assert.match(sent[0].text, /Still have/i);
  assert.ok(sent[0].keyboard.flat().some(b => b.callback_data === 'sw:keep:i1'));
  assert.ok(sent[0].keyboard.flat().some(b => b.callback_data === 'sw:gone:i1'));
  assert.ok(sb.updates.some(u => u.patch.expiry_asked_at));
});

test('an item already asked about expiry is not asked again', async () => {
  const rows = [{
    ...base,
    expires_at: new Date(NOW + 3600_000).toISOString(),
    expiry_asked_at: new Date(NOW - DAY).toISOString(),
  }];
  const sent = [];
  const r = await runSwapLifecycle(fakeSb(rows), { send: async (m) => sent.push(m), now: NOW });
  assert.equal(r.expiryAsked, 0);
  assert.equal(sent.length, 0);
});

test('three days after the first reveal, the lister is asked if it happened', async () => {
  const rows = [{ ...base, first_reveal_at: new Date(NOW - 4 * DAY).toISOString() }];
  const sent = [];
  const r = await runSwapLifecycle(fakeSb(rows), { send: async (m) => sent.push(m), now: NOW });
  assert.equal(r.completionAsked, 1);
  assert.match(sent[0].text, /Did you swap/i);
  assert.ok(sent[0].keyboard.flat().some(b => b.callback_data === 'sw:done:i1'));
});

test('a reveal from yesterday is too fresh to ask about', async () => {
  const rows = [{ ...base, first_reveal_at: new Date(NOW - DAY).toISOString() }];
  const sent = [];
  const r = await runSwapLifecycle(fakeSb(rows), { send: async (m) => sent.push(m), now: NOW });
  assert.equal(r.completionAsked, 0);
});

test('the completion question is asked exactly once, ever', async () => {
  const rows = [{
    ...base,
    first_reveal_at: new Date(NOW - 9 * DAY).toISOString(),
    completion_asked_at: new Date(NOW - 5 * DAY).toISOString(),
  }];
  const sent = [];
  const r = await runSwapLifecycle(fakeSb(rows), { send: async (m) => sent.push(m), now: NOW });
  assert.equal(r.completionAsked, 0);
  assert.equal(sent.length, 0);
});

test('a send failure does not stop the rest of the batch', async () => {
  const rows = [
    { ...base, id: 'a', expires_at: new Date(NOW + 3600_000).toISOString() },
    { ...base, id: 'b', expires_at: new Date(NOW + 3600_000).toISOString() },
  ];
  let n = 0;
  const send = async () => { if (n++ === 0) throw new Error('blocked by user'); };
  const r = await runSwapLifecycle(fakeSb(rows), { send, now: NOW });
  assert.equal(r.expiryAsked, 1, 'the second item was still processed');
});

test('a failed retire update does not stop the rest of the batch', async () => {
  const dueToRetire = {
    ...base,
    // Already asked about both questions, so only the retire loop touches
    // these rows — isolates the assertion to that loop's failure handling.
    expiry_asked_at: new Date(NOW - DAY).toISOString(),
    expires_at: new Date(NOW - DAY).toISOString(),
  };
  const rows = [
    { ...dueToRetire, id: 'a' },
    { ...dueToRetire, id: 'b' },
  ];
  const sb = fakeSb(rows, { failUpdateIds: new Set(['a']) });
  const r = await runSwapLifecycle(sb, { send: async () => {}, now: NOW });

  assert.equal(r.expired, 1, 'only the successful retire is counted');
  assert.ok(
    sb.updates.some(u => u.id === 'b' && u.patch.status === 'expired'),
    'the second item was still retired despite the first failing'
  );
  assert.ok(
    !sb.updates.some(u => u.id === 'a'),
    'the failed update was not recorded as applied'
  );
});

test('prompts name the item so a lister with several posts knows which one', () => {
  const p = expiryPrompt({ id: 'i1', title: 'Redmi Note 10' }, 'en');
  assert.match(p.text, /Redmi Note 10/);
  const c = completionPrompt({ id: 'i1', title: 'Redmi Note 10' }, 'en');
  assert.match(c.text, /Redmi Note 10/);
});
