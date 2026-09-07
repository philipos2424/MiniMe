import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_SIZE, enrichConversations, countBuckets, fetchConversationPage,
} from '../conversationList.mjs';

// ─── Fake PostgREST builder ───────────────────────────────────────────────────
// Records every filter the caller applies so the tests can assert on scoping.
// Chainable like supabase-js: every method returns `this`, awaiting resolves.
function fakeTable(rows, error = null) {
  const calls = { eq: [], in: [], or: [], range: null, order: [], limit: null };
  const b = {
    calls,
    select() { return b; },
    eq(col, val) { calls.eq.push([col, val]); return b; },
    in(col, val) { calls.in.push([col, val]); return b; },
    or(expr) { calls.or.push(expr); return b; },
    order(col, opts) { calls.order.push([col, opts]); return b; },
    range(from, to) { calls.range = [from, to]; return b; },
    limit(n) { calls.limit = n; return b; },
    then(resolve) { return Promise.resolve({ data: error ? null : rows, error }).then(resolve); },
  };
  return b;
}

function fakeSb({ conversations = [], convError = null, previews = [], rpcError = null } = {}) {
  const used = { tables: [], rpc: [] };
  return {
    used,
    from(name) {
      const t = fakeTable(conversations, convError);
      used.tables.push([name, t]);
      return t;
    },
    async rpc(name, args) {
      used.rpc.push([name, args]);
      return { data: rpcError ? null : previews, error: rpcError };
    },
  };
}

const convo = (over = {}) => ({
  id: 'c1', business_id: 'biz-1', last_message_at: '2026-09-04T10:00:00Z',
  requires_owner: false, last_ai_action: null, platform: 'telegram',
  customers: { id: 'cu1', name: 'Selam' },
  ...over,
});

// ─── enrichConversations ──────────────────────────────────────────────────────

test('enrichConversations attaches preview text and direction', () => {
  const [c] = enrichConversations(
    [convo({ id: 'c1' })],
    [{ conversation_id: 'c1', content: 'is it available?', direction: 'inbound', has_file: false }],
  );
  assert.equal(c.last_preview, 'is it available?');
  assert.equal(c.last_direction, 'inbound');
  assert.equal(c.last_has_file, false);
  assert.equal(c.last_file_url, null);
});

test('enrichConversations marks an attachment that has no stored URL yet', () => {
  // Telegram uploads can arrive with a file id before media_url is written.
  // The row is still an attachment and must read as one.
  const [c] = enrichConversations(
    [convo({ id: 'c1' })],
    [{ conversation_id: 'c1', content: null, direction: null, file_url: null, file_type: 'document', has_file: true }],
  );
  assert.equal(c.last_has_file, true);
  assert.equal(c.last_file_url, null);
  assert.equal(c.last_file_type, 'document');
});

test('enrichConversations does not invent a file type when there is no file', () => {
  const [c] = enrichConversations(
    [convo({ id: 'c1' })],
    [{ conversation_id: 'c1', content: 'hi', has_file: false, file_type: 'document' }],
  );
  assert.equal(c.last_file_type, null);
  assert.equal(c.last_has_file, false);
});

test('enrichConversations keeps conversations that have no preview row', () => {
  // A brand-new conversation has no previewable message; it must still render.
  const [c] = enrichConversations([convo({ id: 'c9' })], []);
  assert.equal(c.id, 'c9');
  assert.equal(c.last_preview, null);
  assert.equal(c.last_has_file, false);
  assert.equal(c.customers.name, 'Selam'); // original fields survive
});

test('enrichConversations matches previews to the right conversation', () => {
  const out = enrichConversations(
    [convo({ id: 'a' }), convo({ id: 'b' })],
    [{ conversation_id: 'b', content: 'for b' }, { conversation_id: 'a', content: 'for a' }],
  );
  assert.equal(out[0].last_preview, 'for a');
  assert.equal(out[1].last_preview, 'for b');
});

// ─── countBuckets ─────────────────────────────────────────────────────────────

test('countBuckets separates drafts from merely-unread', () => {
  const rows = [
    convo({ id: '1', requires_owner: true,  last_ai_action: 'drafted' }),
    convo({ id: '2', requires_owner: true,  last_ai_action: 'sent' }),
    convo({ id: '3', requires_owner: false, last_ai_action: 'drafted' }),
  ];
  assert.deepEqual(countBuckets(rows), { all: 3, drafts: 1, unread: 2 });
});

// ─── fetchConversationPage ────────────────────────────────────────────────────

test('fetchConversationPage scopes the list and the previews to one business', async () => {
  const sb = fakeSb({ conversations: [convo({ id: 'c1' })] });
  await fetchConversationPage(sb, { businessId: 'biz-1', filter: 'all', offset: 0 });

  assert.deepEqual(sb.used.tables[0][1].calls.eq, [['business_id', 'biz-1']]);
  // The RPC takes business_id too, so one business can never be enriched with
  // another business's message content.
  assert.deepEqual(sb.used.rpc, [[
    'conversation_previews',
    { p_business_id: 'biz-1', p_conversation_ids: ['c1'] },
  ]]);
});

test('fetchConversationPage asks for a preview for every row on the page', async () => {
  // The bug this replaced fetched a fixed budget of messages across the page,
  // so chatty threads starved quiet ones. Every id must be requested.
  const rows = Array.from({ length: PAGE_SIZE }, (_, i) => convo({ id: `c${i}` }));
  const sb = fakeSb({ conversations: rows });
  await fetchConversationPage(sb, { businessId: 'b', filter: 'all', offset: 0 });
  assert.equal(sb.used.rpc[0][1].p_conversation_ids.length, PAGE_SIZE);
});

test('fetchConversationPage still returns the inbox when previews fail', async () => {
  // Previews decorate rows; losing them must not cost the user their inbox.
  // This is also what lets the code deploy before the migration is applied.
  const sb = fakeSb({ conversations: [convo({ id: 'c1' })], rpcError: { message: 'function does not exist' } });
  const out = await fetchConversationPage(sb, { businessId: 'b', filter: 'all', offset: 0 });
  assert.equal(out.conversations.length, 1);
  assert.equal(out.conversations[0].last_preview, null);
});

test('fetchConversationPage surfaces a failed list query instead of faking an empty inbox', async () => {
  // The original code destructured the error away, which is exactly how a
  // permission failure came to render as "No conversations yet".
  const sb = fakeSb({ convError: { message: 'permission denied for table conversations' } });
  await assert.rejects(
    () => fetchConversationPage(sb, { businessId: 'b', filter: 'all', offset: 0 }),
    /permission denied/,
  );
});

test('fetchConversationPage applies the drafts filter', async () => {
  const sb = fakeSb({ conversations: [] });
  await fetchConversationPage(sb, { businessId: 'biz-1', filter: 'drafts', offset: 0 });
  const eq = sb.used.tables[0][1].calls.eq;
  assert.ok(eq.some(([c, v]) => c === 'requires_owner' && v === true));
  assert.ok(eq.some(([c, v]) => c === 'last_ai_action' && v === 'drafted'));
});

test('fetchConversationPage applies the unread filter without narrowing to drafts', async () => {
  const sb = fakeSb({ conversations: [] });
  await fetchConversationPage(sb, { businessId: 'biz-1', filter: 'unread', offset: 0 });
  const eq = sb.used.tables[0][1].calls.eq;
  assert.ok(eq.some(([c, v]) => c === 'requires_owner' && v === true));
  assert.ok(!eq.some(([c]) => c === 'last_ai_action'));
});

test('fetchConversationPage pages with the shared PAGE_SIZE', async () => {
  const sb = fakeSb({ conversations: [] });
  await fetchConversationPage(sb, { businessId: 'biz-1', filter: 'all', offset: 60 });
  assert.deepEqual(sb.used.tables[0][1].calls.range, [60, 60 + PAGE_SIZE - 1]);
});

test('fetchConversationPage reports hasMore only when the page is full', async () => {
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => convo({ id: `c${i}` }));
  assert.equal((await fetchConversationPage(fakeSb({ conversations: full }), { businessId: 'b', filter: 'all', offset: 0 })).hasMore, true);
  assert.equal((await fetchConversationPage(fakeSb({ conversations: [convo()] }), { businessId: 'b', filter: 'all', offset: 0 })).hasMore, false);
});

test('fetchConversationPage skips the preview call when there are no conversations', async () => {
  const sb = fakeSb({ conversations: [] });
  const out = await fetchConversationPage(sb, { businessId: 'b', filter: 'all', offset: 0 });
  assert.deepEqual(out.conversations, []);
  assert.deepEqual(sb.used.rpc, []);
  assert.deepEqual(out.counts, { all: 0, drafts: 0, unread: 0 });
});

test('fetchConversationPage returns counts only for the unfiltered first page', async () => {
  // Counts describe the whole inbox; computing them from a filtered or later
  // page would report numbers that contradict the tab labels.
  const drafted = convo({ requires_owner: true, last_ai_action: 'drafted' });
  const filtered = await fetchConversationPage(fakeSb({ conversations: [drafted] }), { businessId: 'b', filter: 'drafts', offset: 0 });
  assert.equal(filtered.counts, null);
  const paged = await fetchConversationPage(fakeSb({ conversations: [drafted] }), { businessId: 'b', filter: 'all', offset: PAGE_SIZE });
  assert.equal(paged.counts, null);
});
