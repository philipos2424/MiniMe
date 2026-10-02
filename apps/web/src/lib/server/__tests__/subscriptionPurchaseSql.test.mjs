import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../../../../../packages/db/migrations/056_subscription_purchase_integrity.sql', import.meta.url), 'utf8');
const businessId = '00000000-0000-4000-8000-000000000001';

test('subscription fulfillment executes atomically in PostgreSQL', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  // Minimal production-shaped schema, using real PostgreSQL rather than SQL mocks.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table businesses (
      id uuid primary key, plan_tier text, subscription_status text,
      subscription_plan text, subscription_expires_at timestamptz,
      payment_ref text, payment_verified boolean, payment_method text, payment_notes text
    );
    create table subscriptions (
      user_id uuid primary key references businesses(id), plan_name text,
      credits_total integer, credits_used integer, credits_remaining integer,
      status text, started_at timestamptz, expires_at timestamptz,
      payment_reference text, updated_at timestamptz
    );
    create table payments (
      business_id uuid references businesses(id), amount numeric(12,2),
      currency text, method text constraint payments_method_check check (method in ('chapa')),
      status text, direction text, reference text, description text, completed_at timestamptz
    );
    insert into businesses (id, plan_tier, subscription_status, subscription_expires_at)
      values ('${businessId}', 'pro', 'active', '2099-01-31T12:00:00Z');
  `);
  await db.exec(migration);
  // Reapplying must not invalidate existing schema or privileges.
  await db.exec(migration);
  async function purchase(ref, months = 12) {
    await db.query(`insert into subscription_purchases
      (reference,business_id,provider,plan,duration_months,amount_minor,currency)
      values ($1,$2,'stripe','pro',$3,16800,'USD')`, [ref, businessId, months]);
  }
  const fulfill = (ref, amount = 16800, provider = 'stripe', currency = 'USD') =>
    db.query('select fulfill_subscription_purchase($1,$2,$3,$4) result', [ref, provider, amount, currency]);

  await t.test('annual payment extends existing access and records exactly the charged amount', async () => {
    await purchase('annual');
    const { rows } = await fulfill('annual');
    assert.equal(rows[0].result.duplicate, false);
    assert.equal(new Date(rows[0].result.expires_at).toISOString(), '2100-01-31T12:00:00.000Z');
    const ledger = await db.query('select amount,currency,method from payments');
    assert.deepEqual(ledger.rows, [{ amount: '168.00', currency: 'USD', method: 'stripe' }]);
  });
  await t.test('repeated deliveries grant once and do not create extra ledger entries', async () => {
    const results = await Promise.all([fulfill('annual'), fulfill('annual')]);
    assert.ok(results.every(r => r.rows[0].result.duplicate));
    assert.equal((await db.query('select count(*)::int n from payments')).rows[0].n, 1);
    assert.equal(new Date((await db.query('select expires_at from subscriptions')).rows[0].expires_at).toISOString(), '2100-01-31T12:00:00.000Z');
  });
  await t.test('wrong amount, currency, provider and unknown references cannot grant access', async () => {
    await purchase('unpaid');
    for (const args of [['unpaid', 1], ['unpaid', 16800, 'chapa'], ['unpaid', 16800, 'stripe', 'ETB'], ['missing']]) {
      await assert.rejects(fulfill(...args), /mismatch|Unknown/);
    }
    assert.equal((await db.query("select status from subscription_purchases where reference='unpaid'")).rows[0].status, 'pending');
  });
  await t.test('ledger failures roll back the grant and remain safely retryable', async () => {
    await purchase('rollback');
    await db.exec("alter table payments add constraint simulated_failure check (reference <> 'rollback')");
    await assert.rejects(fulfill('rollback'), /simulated_failure/);
    assert.equal((await db.query("select status from subscription_purchases where reference='rollback'")).rows[0].status, 'pending');
    assert.equal(new Date((await db.query('select expires_at from subscriptions')).rows[0].expires_at).toISOString(), '2100-01-31T12:00:00.000Z');
    await db.exec('alter table payments drop constraint simulated_failure');
    assert.equal((await fulfill('rollback')).rows[0].result.duplicate, false);
  });
  await t.test('anonymous and signed-in browser roles cannot grant subscriptions', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query("select has_function_privilege($1,'fulfill_subscription_purchase(text,text,bigint,text)','EXECUTE') allowed", [role]);
      assert.equal(rows[0].allowed, false);
    }
  });
});
