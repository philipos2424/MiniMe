import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStatus } from '../../plan.js';
import { planStatusServer } from '../planGuard.js';
import { readFileSync } from 'node:fs';
import { paymentState } from '../../paymentState.js';
import { paymentReviewUpdate, extendSubscription } from '../../paymentReview.mjs';
import { reviewSubscriptionPayment, paymentReviewToken } from '../paymentReview.mjs';

const now = Date.parse('2026-01-31T12:00:00Z');
const pending = { id: 'shop', payment_ref: 'invoice-1', subscription_status: 'pending_review', payment_verified: false, verifyet_plan: 'pro_monthly' };

test('finite Pro subscriptions expire even if the tier remains pro; legacy unlimited grants survive', () => {
  const expiry = new Date(Date.now() - 86400000).toISOString();
  const b = { plan_tier: 'pro', subscription_status: 'active', subscription_expires_at: expiry, payment_verified: true };
  assert.equal(planStatus(b).isPro, false);
  assert.equal(planStatusServer(b).isPro, false);
  assert.equal(planStatus(b).expired, true);
  assert.equal(paymentState(b), 'expired');
  assert.equal(planStatus({ plan_tier: 'pro', subscription_status: 'active' }).isPro, true);
  assert.equal(planStatus({ plan_tier: 'pro', subscription_status: 'cancelled' }).isPro, false);
});

test('review preserves current paid/trial access but grants no new access', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  for (const b of [
    { ...pending, subscription_expires_at: future },
    { ...pending, trial_ends_at: future },
  ]) assert.equal(planStatus(b).isPro, true);
  assert.equal(planStatus(pending).isPro, false);
  assert.equal(planStatus({ plan_tier: 'free', subscription_status: 'active' }).isPro, false);
});

test('review grants exactly the purchased period and clamps month ends', () => {
  for (const [key, expiry] of [['pro_monthly', '2026-02-28T12:00:00.000Z'], ['pro_quarterly', '2026-04-30T12:00:00.000Z'], ['pro_annual', '2027-01-31T12:00:00.000Z']]) {
    const result = paymentReviewUpdate({ ...pending, verifyet_plan: key }, 'approve', null, now);
    assert.equal(result.updates.subscription_expires_at, expiry);
    assert.equal(result.period.key, key);
  }
  assert.equal(extendSubscription('2026-02-15T12:00:00Z', 1, now), '2026-03-15T12:00:00.000Z');
  assert.throws(() => paymentReviewUpdate({ ...pending, verifyet_plan: null }, 'approve', null, now), /Choose the paid period/);
  assert.equal(paymentReviewUpdate({ ...pending, verifyet_plan: null }, 'approve', 'pro_quarterly', now).period.months, 3);
  assert.throws(() => paymentReviewUpdate(pending, 'approve', 'pro_annual', now), /recorded period/);
});

test('monthly spot-check approval does not extend access a second time; rejection removes only provisional access', () => {
  const b = { ...pending, subscription_status: 'active', payment_proof_url: 'proof', payment_notes: 'Auto-activated (monthly, awaiting spot-check)', subscription_expires_at: '2026-02-28T12:00:00Z', plan_tier: 'pro' };
  const approved = paymentReviewUpdate(b, 'approve', null, now).updates;
  assert.equal(approved.subscription_expires_at, b.subscription_expires_at);
  assert.equal(approved.payment_verified, true);
  const rejected = paymentReviewUpdate(b, 'reject', null, now).updates;
  assert.equal(rejected.subscription_status, 'cancelled');
  assert.equal(rejected.plan_tier, 'free');
  assert.equal(rejected.subscription_expires_at, null);
  const retained = paymentReviewUpdate({ ...pending, subscription_expires_at: '2026-02-15T12:00:00Z', plan_tier: 'pro' }, 'reject', null, now).updates;
  assert.equal(retained.subscription_status, 'active');
  assert.equal(retained.subscription_expires_at, undefined);
  const legacy = paymentReviewUpdate({ ...pending, plan_tier: 'pro' }, 'reject', null, now).updates;
  assert.equal(legacy.subscription_status, 'active');
  assert.equal(legacy.plan_tier, undefined);
});

test('admin review endpoint authenticates, reports storage failures and logs only committed approvals', async () => {
  const source = readFileSync(new URL('../../../app/api/admin/payments/[id]/review/route.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/export const /g, 'const ').replace('export async function POST', 'async function POST');
  let allowed = false, fail = false, saves = 0, audits = 0, events = 0;
  const post = new Function('NextResponse', 'requireAdminRequest', 'supabase', 'reviewSubscriptionPayment', 'audit', 'logSubscriptionEvent', 'sendTelegramMessage', source + '; return POST;')(
    { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
    async () => allowed ? { id: 1 } : null, () => ({}), async () => {
      saves++;
      if (fail) throw new Error('Could not save payment decision. Please retry.');
      return { business: { subscription_expires_at: '2026-02-28T12:00:00Z' }, period: { key: 'pro_monthly', amount: 1300 }, prior_status: 'pending_review' };
    }, async () => { audits++; }, () => { events++; }, async () => {},
  );
  const request = { json: async () => ({ action: 'approve', expected_ref: 'invoice-1' }) };
  const params = { params: { id: 'shop' } };
  assert.equal((await post(request, params)).status, 403);
  assert.equal(saves, 0);
  allowed = true; fail = true;
  assert.equal((await post(request, params)).status, 503);
  assert.equal(audits, 0); assert.equal(events, 0);
  fail = false;
  assert.equal((await post(request, params)).status, 200);
  assert.equal(audits, 1); assert.equal(events, 1);
});

test('Telegram review buttons identify the payment within the 64-byte callback limit', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  assert.ok(Buffer.byteLength(`sub_approve_${id}:${paymentReviewToken('reference')}`) <= 64);
  const source = readFileSync(new URL('../replyEngine.js', import.meta.url), 'utf8');
  const start = source.indexOf("if (data.startsWith('sub_approve_')");
  const block = source.slice(start, source.indexOf('// Notify owner', start));
  assert.match(block, /reviewSubscriptionPayment/);
  assert.match(block, /if \(!reviewToken\)/);
  assert.ok(!block.includes('setMonth'));
});

test('bank verification storage errors cannot notify an owner or record a subscription', async () => {
  const source = readFileSync(new URL('../paymentVerification.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('export async function applyVerificationOutcome('), source.indexOf('async function notifyOwner('))
    .replace('export async function', 'async function');
  let notified = false, subscribed = false;
  const apply = new Function('supabase', 'REASON_TEXT', 'PLAN_MONTHS', 'extendSubscription', 'logVerification', 'logSubscriptionEvent', 'audit', 'notifyOwner', 'notifyAdmin', code + '; return applyVerificationOutcome;')(
    () => database({ ...pending }, { failWrite: true }), {}, { pro_monthly: 1 }, extendSubscription,
    async () => {}, () => { subscribed = true; }, async () => {}, async () => { notified = true; }, async () => { notified = true; },
  );
  await assert.rejects(apply({ business: pending, result: { amount: 1300 }, verdict: { accept: true, reason: 'confirmed' } }), /Could not save/);
  assert.equal(notified, false);
  assert.equal(subscribed, false);
});

function database(row, { failRead = false, failWrite = false } = {}) {
  return { from() {
    const filters = []; let update;
    const q = {
      select() { return q; }, maybeSingle() { return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      is(k, v) { filters.push(r => (r[k] ?? null) === v); return q; },
      update(v) { update = v; return q; },
      then(resolve) {
        if (update ? failWrite : failRead) return Promise.resolve({ data: null, error: { message: 'storage unavailable' } }).then(resolve);
        const matches = filters.every(f => f(row));
        if (matches && update) Object.assign(row, update);
        return Promise.resolve({ data: matches ? { ...row } : null, error: null }).then(resolve);
      },
    }; return q;
  } };
}

test('concurrent approvals apply once; stale references and callback tokens fail closed', async () => {
  const row = { ...pending };
  const sb = database(row);
  const args = { businessId: 'shop', action: 'approve', expectedRef: row.payment_ref, now };
  const results = await Promise.allSettled([reviewSubscriptionPayment(sb, args), reviewSubscriptionPayment(sb, args)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(row.subscription_expires_at, '2026-02-28T12:00:00.000Z');
  await assert.rejects(reviewSubscriptionPayment(database({ ...pending }), { ...args, expectedRef: 'old-invoice' }), /changed/);
  await assert.rejects(reviewSubscriptionPayment(database({ ...pending }), { ...args, token: paymentReviewToken('old-invoice') }), /changed/);
  await assert.rejects(reviewSubscriptionPayment(database({ ...pending }, { failWrite: true }), args), /save/);
  await assert.rejects(reviewSubscriptionPayment(database({ ...pending }, { failRead: true }), args), /load/);
});
