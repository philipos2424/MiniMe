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

test('paymentState agrees with planStatus: active + null expiry is not Pro', () => {
  const b = { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: null, trial_ends_at: future(10) };
  assert.equal(planStatus(b).isPro, false);
  assert.notEqual(paymentState(b), 'granted');
});

test('paymentState still reports a dated active grant as granted', () => {
  const b = { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: future(5) };
  assert.equal(paymentState(b), 'granted');
});
