import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVED_LIMIT, EDITABLE_FIELDS, pickEditableFields,
  listProducts, createProduct, updateProduct, deleteProduct,
} from '../productCrud.mjs';

// ─── Fake PostgREST builder ───────────────────────────────────────────────────
// Mirrors the shape used by conversationList.test.mjs: chainable, records every
// filter so the tests can assert the business scoping actually reached the query.
function fakeTable(rows, error = null) {
  const calls = { eq: [], order: [], limit: null, insert: null, update: null, deleted: false, select: 0 };
  const b = {
    calls,
    select() { calls.select++; return b; },
    eq(col, val) { calls.eq.push([col, val]); return b; },
    order(col, opts) { calls.order.push([col, opts]); return b; },
    limit(n) { calls.limit = n; return b; },
    insert(v) { calls.insert = v; return b; },
    update(v) { calls.update = v; return b; },
    delete() { calls.deleted = true; return b; },
    single() { return b; },
    maybeSingle() { return b; },
    then(resolve) { return Promise.resolve({ data: error ? null : rows, error }).then(resolve); },
  };
  return b;
}

function fakeSb(perTable = {}) {
  const used = [];
  return {
    used,
    from(name) {
      const spec = perTable[name] || {};
      // `??` would turn a deliberate `rows: null` — what maybeSingle() returns
      // when nothing matched — back into [], hiding the not-found path.
      const rows = Object.prototype.hasOwnProperty.call(spec, 'rows') ? spec.rows : [];
      const t = fakeTable(rows, spec.error ?? null);
      used.push([name, t]);
      return t;
    },
  };
}

const prod = (over = {}) => ({
  id: 'p1', business_id: 'biz-1', name: 'Coffee', price: 100,
  stock_quantity: 5, is_active: true, ...over,
});

// ─── pickEditableFields ───────────────────────────────────────────────────────

test('pickEditableFields keeps only whitelisted columns', () => {
  const out = pickEditableFields({ name: 'Tea', price: 50, category: 'Drinks' });
  assert.deepEqual(out, { name: 'Tea', price: 50, category: 'Drinks' });
});

test('pickEditableFields strips business_id so a client cannot reassign ownership', () => {
  const out = pickEditableFields({ name: 'Tea', business_id: 'someone-else' });
  assert.deepEqual(out, { name: 'Tea' });
  assert.equal('business_id' in out, false);
});

test('pickEditableFields strips id so a client cannot repoint the row', () => {
  const out = pickEditableFields({ id: 'other-product', price: 1 });
  assert.deepEqual(out, { price: 1 });
});

test('pickEditableFields drops unknown columns rather than passing them to PostgREST', () => {
  const out = pickEditableFields({ name: 'Tea', drop_table: 1, search_embedding: [1, 2] });
  assert.deepEqual(out, { name: 'Tea' });
});

test('pickEditableFields keeps explicit nulls — clearing a price is a real edit', () => {
  const out = pickEditableFields({ price: null, stock_quantity: null });
  assert.deepEqual(out, { price: null, stock_quantity: null });
});

test('pickEditableFields returns empty object for no recognised fields', () => {
  assert.deepEqual(pickEditableFields({ nonsense: true }), {});
  assert.deepEqual(pickEditableFields(null), {});
});

test('EDITABLE_FIELDS never contains identity or ownership columns', () => {
  for (const forbidden of ['id', 'business_id', 'created_at', 'search_embedding']) {
    assert.equal(EDITABLE_FIELDS.includes(forbidden), false, `${forbidden} must not be editable`);
  }
});

// ─── listProducts ─────────────────────────────────────────────────────────────

test('listProducts scopes both queries to the business', async () => {
  const sb = fakeSb({ products: { rows: [prod()] } });
  await listProducts(sb, { businessId: 'biz-1' });
  for (const [, t] of sb.used) {
    assert.ok(t.calls.eq.some(([c, v]) => c === 'business_id' && v === 'biz-1'));
  }
});

test('listProducts splits active from archived and caps the archive', async () => {
  const sb = fakeSb({ products: { rows: [prod()] } });
  await listProducts(sb, { businessId: 'biz-1' });
  const active = sb.used[0][1];
  const archived = sb.used[1][1];
  assert.ok(active.calls.eq.some(([c, v]) => c === 'is_active' && v === true));
  assert.ok(archived.calls.eq.some(([c, v]) => c === 'is_active' && v === false));
  assert.equal(archived.calls.limit, ARCHIVED_LIMIT);
});

test('listProducts throws on error rather than reporting an empty catalogue', async () => {
  const sb = fakeSb({ products: { error: { message: 'permission denied for table products' } } });
  await assert.rejects(
    () => listProducts(sb, { businessId: 'biz-1' }),
    /permission denied for table products/,
  );
});

test('listProducts returns both lists on success', async () => {
  const sb = fakeSb({ products: { rows: [prod()] } });
  const out = await listProducts(sb, { businessId: 'biz-1' });
  assert.deepEqual(Object.keys(out).sort(), ['archived', 'products']);
  assert.equal(out.products.length, 1);
});

// ─── createProduct ────────────────────────────────────────────────────────────

test('createProduct stamps the caller business id, ignoring any client-supplied one', async () => {
  const sb = fakeSb({ products: { rows: [prod()] } });
  await createProduct(sb, { businessId: 'biz-1', fields: { name: 'Tea', business_id: 'attacker' } });
  assert.equal(sb.used[0][1].calls.insert.business_id, 'biz-1');
});

test('createProduct defaults to active', async () => {
  const sb = fakeSb({ products: { rows: [prod()] } });
  await createProduct(sb, { businessId: 'biz-1', fields: { name: 'Tea' } });
  assert.equal(sb.used[0][1].calls.insert.is_active, true);
});

test('createProduct requires a name', async () => {
  const sb = fakeSb({ products: { rows: [] } });
  await assert.rejects(() => createProduct(sb, { businessId: 'biz-1', fields: {} }), /name/i);
});

test('createProduct surfaces a write failure', async () => {
  const sb = fakeSb({ products: { error: { message: 'permission denied' } } });
  await assert.rejects(
    () => createProduct(sb, { businessId: 'biz-1', fields: { name: 'Tea' } }),
    /permission denied/,
  );
});

// ─── updateProduct ────────────────────────────────────────────────────────────

test('updateProduct filters on BOTH id and business_id', async () => {
  const sb = fakeSb({ products: { rows: [prod()] } });
  await updateProduct(sb, { businessId: 'biz-1', productId: 'p1', fields: { price: 7 } });
  const t = sb.used[0][1];
  assert.ok(t.calls.eq.some(([c, v]) => c === 'id' && v === 'p1'));
  assert.ok(t.calls.eq.some(([c, v]) => c === 'business_id' && v === 'biz-1'),
    'without the business_id filter another shop’s product could be edited');
});

test('updateProduct never writes business_id even if the client sends one', async () => {
  const sb = fakeSb({ products: { rows: [prod()] } });
  await updateProduct(sb, {
    businessId: 'biz-1', productId: 'p1',
    fields: { price: 7, business_id: 'attacker' },
  });
  assert.equal('business_id' in sb.used[0][1].calls.update, false);
});

test('updateProduct rejects an edit with no usable fields', async () => {
  const sb = fakeSb({ products: { rows: [prod()] } });
  await assert.rejects(
    () => updateProduct(sb, { businessId: 'biz-1', productId: 'p1', fields: { bogus: 1 } }),
    /no editable fields/i,
  );
});

test('updateProduct reports a row that does not belong to the caller as not found', async () => {
  const sb = fakeSb({ products: { rows: null } });
  const out = await updateProduct(sb, { businessId: 'biz-1', productId: 'p1', fields: { price: 7 } });
  assert.equal(out.found, false);
});

test('updateProduct surfaces a write failure', async () => {
  const sb = fakeSb({ products: { error: { message: 'permission denied' } } });
  await assert.rejects(
    () => updateProduct(sb, { businessId: 'biz-1', productId: 'p1', fields: { price: 7 } }),
    /permission denied/,
  );
});

// ─── deleteProduct ────────────────────────────────────────────────────────────

test('deleteProduct filters on BOTH id and business_id', async () => {
  const sb = fakeSb({ products: { rows: [prod()] } });
  await deleteProduct(sb, { businessId: 'biz-1', productId: 'p1' });
  const t = sb.used[0][1];
  assert.equal(t.calls.deleted, true);
  assert.ok(t.calls.eq.some(([c, v]) => c === 'id' && v === 'p1'));
  assert.ok(t.calls.eq.some(([c, v]) => c === 'business_id' && v === 'biz-1'),
    'without the business_id filter any product id could be deleted');
});

test('deleteProduct surfaces a failure rather than reporting success', async () => {
  const sb = fakeSb({ products: { error: { message: 'permission denied' } } });
  await assert.rejects(
    () => deleteProduct(sb, { businessId: 'biz-1', productId: 'p1' }),
    /permission denied/,
  );
});
