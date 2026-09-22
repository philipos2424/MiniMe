/**
 * The bridge is the only place swap logic meets the search bot, so the one
 * thing tested here in isolation is the callback router. Everything else in
 * this module is I/O glue over units already covered by their own tests.
 *
 * `sw:` vs `sb:` matters: the search bot's existing callbacks all start `sb:`,
 * and a router that swallowed those would silently break search pagination,
 * ratings and feedback — failures nobody would attribute to the swap feature.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSwapCallback, handleSwapCallback, handleSwapPhoto, appendSwapBlocks,
} from '../swap/swapBotBridge.mjs';

/**
 * Minimal fake Supabase client covering just `swap_items`/`swap_drafts`
 * shapes these tests touch. `updates` records every `.update(patch)` call
 * along with the chain of `.eq()` filters applied to it, so a test can
 * assert both WHAT changed and WHO it was scoped to.
 */
function fakeSb({ items = [], failDrafts = false } = {}) {
  const state = { items: [...items], updates: [], sentDrafts: [] };
  const chain = (table, patch) => {
    const filters = {};
    const c = {
      eq(field, val) { filters[field] = val; return c; },
      neq(field, val) { filters[field] = { neq: val }; return c; },
      // Awaiting the chain (however many .eq()/.neq() calls preceded it) is
      // what actually "sends" the update — record it exactly once, here.
      then(resolve) {
        state.updates.push({ table, patch, filters });
        resolve({ data: null, error: null });
      },
    };
    return c;
  };
  return {
    state,
    from(table) {
      if (table === 'swap_items') {
        return {
          update: (patch) => chain(table, patch),
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        };
      }
      if (table === 'swap_drafts') {
        return {
          upsert: async (row) => {
            if (failDrafts) return { error: { message: 'relation "swap_drafts" does not exist' } };
            state.sentDrafts.push(row);
            return { error: null };
          },
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function fakeTg(sent) {
  return async (token, method, body) => {
    sent.push({ method, body });
    return { ok: true, result: {} };
  };
}

test('swap callbacks parse into an action and its argument', () => {
  assert.deepEqual(parseSwapCallback('sw:want:abc-123'), { action: 'want', arg: 'abc-123' });
  assert.deepEqual(parseSwapCallback('sw:kind:swap'),    { action: 'kind', arg: 'swap' });
  assert.deepEqual(parseSwapCallback('sw:area:other'),   { action: 'area', arg: 'other' });
  assert.deepEqual(parseSwapCallback('sw:done:i1'),      { action: 'done', arg: 'i1' });
});

test('existing search callbacks are left alone', () => {
  for (const d of ['sb:more:123:0', 'sb:fb:up:9', 'sb:grid:1:0']) {
    assert.equal(parseSwapCallback(d), null, d);
  }
});

test('junk data does not throw', () => {
  for (const d of [null, undefined, '', 'sw', 'sw:', 'nonsense']) {
    assert.doesNotThrow(() => parseSwapCallback(d));
  }
});

// ── I1: sw:keep must restore status, not just extend expires_at ────────────

test('sw:keep restores status to active alongside extending expiry', async () => {
  const sb = fakeSb();
  const sent = [];
  const cq = { data: 'sw:keep:item1', message: { chat: { id: 555 } }, from: { id: 42 } };
  await handleSwapCallback({ sb, tg: fakeTg(sent), token: 't', cq, rateLimitPersistent: async () => ({ ok: true, persistent: true }) });
  const upd = sb.state.updates.find(u => u.table === 'swap_items');
  assert.ok(upd, 'an update was made');
  assert.equal(upd.patch.status, 'active');
  assert.ok(upd.patch.expires_at);
  assert.equal(upd.patch.expiry_asked_at, null);
});

// ── I4: sw:keep/sw:gone/sw:done must scope by owner, like sw:hide already does ─

test('sw:keep, sw:gone and sw:done all scope their update to the caller\'s own item', async () => {
  for (const [data, action] of [['sw:keep:item1', 'keep'], ['sw:gone:item1', 'gone'], ['sw:done:item1', 'done']]) {
    const sb = fakeSb();
    const cq = { data, message: { chat: { id: 555 } }, from: { id: 42 } };
    await handleSwapCallback({ sb, tg: fakeTg([]), token: 't', cq, rateLimitPersistent: async () => ({ ok: true, persistent: true }) });
    const upd = sb.state.updates.find(u => u.table === 'swap_items');
    assert.ok(upd, `${action}: an update was made`);
    assert.equal(upd.filters.id, 'item1', action);
    assert.equal(upd.filters.telegram_user_id, 42, `${action} must scope by telegram_user_id like sw:hide does`);
  }
});

// ── I3: the reveal cap must fail closed when the persistent limiter was not
// actually used (RPC error/missing → in-memory fallback, near-unlimited on Vercel) ─

test('sw:want refuses the reveal when rateLimitPersistent could not really check Postgres', async () => {
  const sb = fakeSb();
  const sent = [];
  const cq = { data: 'sw:want:item1', message: { chat: { id: 555 } }, from: { id: 42 } };
  // ok: true (the in-memory fallback allowed it) but persistent: false — this
  // is exactly the "RPC errored, fell back" case that must not go through.
  await handleSwapCallback({ sb, tg: fakeTg(sent), token: 't', cq, rateLimitPersistent: async () => ({ ok: true, persistent: false }) });
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /lot of contacts|try again/i);
  assert.equal(sb.state.sentDrafts.length, 0, 'no offer draft should be opened when the cap could not be checked');
});

test('sw:want proceeds when the persistent limiter genuinely allowed it', async () => {
  const sb = fakeSb();
  const sent = [];
  const cq = { data: 'sw:want:item1', message: { chat: { id: 555 } }, from: { id: 42 } };
  await handleSwapCallback({ sb, tg: fakeTg(sent), token: 't', cq, rateLimitPersistent: async () => ({ ok: true, persistent: true }) });
  assert.equal(sb.state.sentDrafts.length, 1);
  assert.match(sent[0].body.text, /offering/i);
});

// ── C3: the deploy window — handleSwapPhoto must go silent when swap_drafts
// does not exist yet, instead of sending a prompt with a dead button ────────

test('handleSwapPhoto sends nothing when the draft could not actually be stored', async () => {
  const sb = fakeSb({ failDrafts: true });
  const sent = [];
  const msg = { from: { id: 42, username: 'meron' }, chat: { id: 555 }, photo: [{ file_id: 'f1' }] };
  await handleSwapPhoto({ sb, tg: fakeTg(sent), token: 't', msg });
  assert.equal(sent.length, 0, 'no prompt — the buttons on it would do nothing');
});

test('handleSwapPhoto sends the prompt once the draft is really stored', async () => {
  const sb = fakeSb();
  const sent = [];
  const msg = { from: { id: 42, username: 'meron' }, chat: { id: 555 }, photo: [{ file_id: 'f1' }] };
  await handleSwapPhoto({ sb, tg: fakeTg(sent), token: 't', msg });
  assert.equal(sent.length, 1);
  assert.equal(sb.state.sentDrafts.length, 1);
});

test('a photo whose caption starts with / is a command, not a swap post', async () => {
  const sb = fakeSb();
  const sent = [];
  const msg = { from: { id: 42, username: 'meron' }, chat: { id: 555 }, photo: [{ file_id: 'f1' }], caption: '/start' };
  await handleSwapPhoto({ sb, tg: fakeTg(sent), token: 't', msg });
  assert.equal(sent.length, 0);
  assert.equal(sb.state.sentDrafts.length, 0, 'no draft opened for a command');
});

// ── C3: appendSwapBlocks must go completely silent when the store could not
// be reached (missing tables in the hand-applied-migration deploy window) ──

test('appendSwapBlocks sends nothing when the swap store is unavailable', async () => {
  // fetchSwapMatches sees a DB error for a real query and reports unavailable.
  const sb = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        gt() { return this; },
        overlaps() { return this; },
        neq() { return this; },
        limit: async () => ({ data: null, error: { message: 'relation "swap_items" does not exist' } }),
      };
    },
  };
  const sent = [];
  await appendSwapBlocks({
    sb, tg: fakeTg(sent), token: 't', chatId: 555, senderId: 42,
    query: 'phone', parsed: { keywords: ['phone'], category: null },
  });
  assert.equal(sent.length, 0, 'not even the "nobody\'s swapping X yet" recruitment line — that would be a claim we never checked');
});

// ── C2: appendSwapBlocks must actually send the photo cards, degrading to
// a text card when Telegram refuses the photo ───────────────────────────────

test('appendSwapBlocks sends a good photo card as a photo', async () => {
  const sb = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        gt() { return this; },
        overlaps(col) {
          this._col = col;
          return this;
        },
        neq() { return this; },
        limit: async function () {
          if (this._col === 'keywords') {
            return { data: [{ id: 'i1', title: 'Speaker', wants_text: 'phone', area: 'bole', photo_file_ids: ['file1'], created_at: new Date().toISOString() }], error: null };
          }
          return { data: [], error: null };
        },
      };
    },
  };
  const sent = [];
  await appendSwapBlocks({
    sb, tg: fakeTg(sent), token: 't', chatId: 555, senderId: 9,
    query: 'phone', parsed: { keywords: ['phone'], category: null },
  });
  const photoSend = sent.find(s => s.method === 'sendPhoto');
  assert.ok(photoSend, 'a sendPhoto call was made for the card');
  assert.equal(photoSend.body.photo, 'file1');
});

test('appendSwapBlocks falls back to a text card when Telegram refuses the photo', async () => {
  const sb = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        gt() { return this; },
        overlaps(col) { this._col = col; return this; },
        neq() { return this; },
        limit: async function () {
          if (this._col === 'keywords') {
            return { data: [{ id: 'i1', title: 'Speaker', wants_text: 'phone', area: 'bole', photo_file_ids: ['bad-file'], created_at: new Date().toISOString() }], error: null };
          }
          return { data: [], error: null };
        },
      };
    },
  };
  const sent = [];
  const tg = async (token, method, body) => {
    sent.push({ method, body });
    if (method === 'sendPhoto') return { ok: false, description: 'wrong file_id' };
    return { ok: true, result: {} };
  };
  await appendSwapBlocks({
    sb, tg, token: 't', chatId: 555, senderId: 9,
    query: 'phone', parsed: { keywords: ['phone'], category: null },
  });
  const fallback = sent.find(s => s.method === 'sendMessage' && /Speaker/.test(s.body.text));
  assert.ok(fallback, 'the caption reached the user as a text message instead of vanishing');
});
