import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateSpec, scopeColumn, scopeInsertValues, stripSecrets } from '../../ownerDbProtocol.mjs';

test('the Chats list query is allowed', () => {
  const v = validateSpec({
    table: 'conversations', op: 'select', select: '*, customers(*)',
    filters: [{ m: 'eq', a: ['business_id', 'x'] }],
    order: [{ col: 'last_message_at', opts: { ascending: false } }], range: [0, 29],
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.spec.range, [0, 29]);
});

test('unknown tables and ops are refused', () => {
  assert.equal(validateSpec({ table: 'platform_settings' }).ok, false);
  assert.equal(validateSpec({ table: 'encrypted_secrets' }).ok, false);
  assert.equal(validateSpec({ table: 'messages', op: 'delete', filters: [{ m: 'eq', a: ['id', 1] }] }).ok, false);
  assert.equal(validateSpec({ table: 'businesses', op: 'insert', values: { name: 'x' } }).ok, false);
});

test('business rows: only safe columns can be updated', () => {
  assert.equal(validateSpec({ table: 'businesses', op: 'update', values: { notification_prefs: {} }, filters: [{ m: 'eq', a: ['id', 'b'] }] }).ok, true);
  for (const col of ['plan_tier', 'subscription_status', 'owner_telegram_id', 'telegram_bot_token_enc', 'sub_admin_telegram_ids']) {
    assert.equal(validateSpec({ table: 'businesses', op: 'update', values: { [col]: 'x' }, filters: [{ m: 'eq', a: ['id', 'b'] }] }).ok, false, col);
  }
});

test('writes cannot move rows to another business', () => {
  const v = validateSpec({ table: 'products', op: 'update', values: { name: 'Card', business_id: 'other' }, filters: [{ m: 'eq', a: ['id', 'p1'] }] });
  assert.equal(v.ok, true);
  assert.ok(!('business_id' in v.spec.values));
  const ins = validateSpec({ table: 'products', op: 'insert', values: { name: 'Card', business_id: 'other' } });
  assert.equal(scopeInsertValues(ins.spec.values, 'mine').business_id, 'mine');
});

test('update and delete need a filter', () => {
  assert.equal(validateSpec({ table: 'products', op: 'delete' }).ok, false);
  assert.equal(validateSpec({ table: 'customers', op: 'update', values: { tags: [] } }).ok, false);
});

test('bad column names are refused', () => {
  assert.equal(validateSpec({ table: 'customers', filters: [{ m: 'eq', a: ['id;drop', 1] }] }).ok, false);
  assert.equal(validateSpec({ table: 'customers', order: [{ col: 'name desc' }] }).ok, false);
});

test('row caps apply', () => {
  assert.equal(validateSpec({ table: 'messages', limit: 999999 }).spec.limit, 1000);
});

test('scope column: businesses by id, everything else by business_id', () => {
  assert.equal(scopeColumn('businesses'), 'id');
  assert.equal(scopeColumn('messages'), 'business_id');
});

test('secrets are stripped at any depth', () => {
  const out = stripSecrets([{ id: 1, telegram_bot_token_enc: 'x', businesses: { name: 'a', webhook_secret: 's' } }]);
  assert.deepEqual(out, [{ id: 1, businesses: { name: 'a' } }]);
});

test('owner screens use the server-routed client, not the anon browser client', () => {
  const files = [
    'components/pages/ConversationsPage.jsx', 'components/conversations/ChatDetail.jsx',
    'components/pages/CustomersPage.jsx', 'components/customers/CustomerProfile.jsx',
    'components/pages/CatalogPage.jsx', 'components/pages/ProductsPage.jsx',
    'app/(dashboard)/customers/[id]/page.js', 'app/(dashboard)/settings/search/page.js',
    'app/(dashboard)/settings/people/page.js',
  ];
  for (const f of files) {
    const src = readFileSync(fileURLToPath(new URL(`../../../${f}`, import.meta.url)), 'utf8');
    assert.ok(!src.includes("lib/supabase-browser'"), `${f} must not query with the anon browser client`);
    assert.ok(src.includes("lib/owner-db'"), `${f} uses lib/owner-db`);
  }
});
