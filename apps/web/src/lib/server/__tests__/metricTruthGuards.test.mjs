/**
 * Guards for the admin metric-truth work.
 *
 * deductCreditAndLogUsage once copied subscriptions.status (column default
 * 'active') onto businesses.subscription_status on every AI reply. planStatus()
 * reads active-with-no-expiry as NOT Pro, so every new shop lost its trial on
 * its first AI reply, while paymentState() (still honouring null expiry)
 * labelled the same shop "granted" on the admin page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paymentState } from '../../paymentState.js';
import { planStatus } from '../../plan.js';

const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const future = d => new Date(Date.now() + d * 86400000).toISOString();

test('credit deduction never writes plan state onto businesses', () => {
  const src = stripComments(read('lib/server/billing.js'));
  const start = src.indexOf('export async function deductCreditAndLogUsage');
  const end = src.indexOf('export ', start + 10);
  const fn = src.slice(start, end);
  assert.ok(start >= 0, 'deductCreditAndLogUsage must exist');
  assert.ok(!/from\('businesses'\)/.test(fn), 'deductCreditAndLogUsage must not touch businesses');
});

// main and feat/swap-barter disagree on whether active + null expiry is Pro
// (feat closed that door, main has not). The invariant that holds on both:
// the admin label says "granted" exactly when planStatus really grants Pro.
test('paymentState says granted exactly when planStatus grants unpaid Pro', () => {
  const b = { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: null, trial_ends_at: future(10) };
  assert.equal(paymentState(b) === 'granted', planStatus(b).isPro);
});

test('paymentState still reports a dated active grant as granted', () => {
  const b = { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: future(5) };
  assert.equal(paymentState(b), 'granted');
});

test('admin PATCH can mark a shop internal', () => {
  const src = stripComments(read('app/api/admin/businesses/[id]/route.js'));
  assert.match(src, /'is_internal' in body\)\s*updates\.is_internal\s*=\s*!!body\.is_internal/);
});

test('migration 060 creates rollup tables without a businesses FK on shop_daily', () => {
  const sql = readFileSync(new URL('../../../../../../packages/db/migrations/060_metrics_rollup.sql', import.meta.url), 'utf8');
  for (const t of ['shop_daily', 'platform_daily', 'metrics_rollup_runs']) assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
  assert.match(sql, /add column if not exists is_internal boolean not null default false/);
  const shopDaily = sql.slice(sql.indexOf('public.shop_daily'), sql.indexOf('public.platform_daily'));
  assert.ok(!/references/i.test(shopDaily), 'shop_daily must not FK businesses (erasure re-keys rows)');
});

test('metrics-rollup cron is authorized, idempotent, and scheduled', () => {
  const src = stripComments(read('app/api/cron/metrics-rollup/route.js'));
  assert.match(src, /isCronAuthorized\(request\)/);
  assert.match(src, /'business_id,day'/);
  assert.match(src, /'platform_daily', platformRows, 'day'/);
  assert.match(src, /metrics_rollup_runs/);
  const vercel = JSON.parse(readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8'));
  assert.ok(vercel.crons.some(c => c.path === '/api/cron/metrics-rollup' && c.schedule === '0 23 * * *'));
});

test('rollup upserts state-bearing rows separately from past rows', () => {
  const src = stripComments(read('app/api/cron/metrics-rollup/route.js'));
  assert.match(src, /'plan_state' in r/);
});
