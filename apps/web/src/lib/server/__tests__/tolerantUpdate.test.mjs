/**
 * Migrations here are applied by hand, so deployed code routinely knows about a
 * column the database does not yet have. The proof-upload path writes two such
 * columns alongside the record of a real payment; Supabase fails the whole
 * update if any one of them is unknown.
 *
 * The regression this guards: the original helper hardcoded a retry on
 * payment_submitted_at. Once that migration was applied and payment_state
 * became the newly-added column, the hardcoded retry no longer matched — so
 * every proof upload threw, losing the payment record entirely, on exactly the
 * deploy where the tolerance was supposed to matter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateBusinessTolerantly, MIGRATION_GATED_COLUMNS } from '../tolerantUpdate.mjs';

/**
 * Fake Supabase that rejects any update mentioning a column not in `has`,
 * with the message shape PostgREST actually returns.
 */
function fakeSb(has) {
  const attempts = [];
  return {
    attempts,
    from: () => ({
      update(payload) {
        attempts.push(payload);
        const unknown = Object.keys(payload).find(k => !has.includes(k));
        return {
          eq: async () => unknown
            ? { error: { message: `Could not find the '${unknown}' column of 'businesses' in the schema cache` } }
            : { error: null },
        };
      },
    }),
  };
}

const ESSENTIAL = { payment_proof_url: 'https://x/y.jpg', payment_verified: false };
const FULL = { ...ESSENTIAL, payment_state: 'in_review', payment_submitted_at: '2026-08-24T00:00:00Z' };

test('writes everything in one attempt when the database is current', async () => {
  const sb = fakeSb([...Object.keys(FULL)]);
  const { dropped } = await updateBusinessTolerantly(sb, 'biz-1', FULL);
  assert.deepEqual(dropped, []);
  assert.equal(sb.attempts.length, 1);
});

test('drops payment_state when that migration has not run, and still records the payment', async () => {
  const sb = fakeSb(['payment_proof_url', 'payment_verified', 'payment_submitted_at']);
  const { dropped } = await updateBusinessTolerantly(sb, 'biz-1', FULL);
  assert.deepEqual(dropped, ['payment_state']);
  const written = sb.attempts.at(-1);
  assert.equal(written.payment_proof_url, ESSENTIAL.payment_proof_url);
  assert.equal(written.payment_verified, false);
  assert.ok(!('payment_state' in written));
});

test('drops payment_submitted_at when only that column is missing', async () => {
  const sb = fakeSb(['payment_proof_url', 'payment_verified', 'payment_state']);
  const { dropped } = await updateBusinessTolerantly(sb, 'biz-1', FULL);
  assert.deepEqual(dropped, ['payment_submitted_at']);
  assert.equal(sb.attempts.at(-1).payment_state, 'in_review');
});

test('drops both when neither migration has run — the payment is never lost', async () => {
  const sb = fakeSb(['payment_proof_url', 'payment_verified']);
  const { dropped } = await updateBusinessTolerantly(sb, 'biz-1', FULL);
  assert.deepEqual(dropped.sort(), ['payment_state', 'payment_submitted_at']);
  assert.deepEqual(sb.attempts.at(-1), ESSENTIAL);
});

test('a failure on an essential column surfaces instead of being degraded away', async () => {
  // payment_proof_url is not migration-gated: losing it means a merchant paid
  // and we kept no evidence, which must be an error, not a warning.
  const sb = fakeSb(['payment_verified', 'payment_state', 'payment_submitted_at']);
  await assert.rejects(
    () => updateBusinessTolerantly(sb, 'biz-1', FULL),
    /payment_proof_url/,
  );
});

test('never retries more times than there are gated columns', async () => {
  const sb = fakeSb([]);
  await assert.rejects(() => updateBusinessTolerantly(sb, 'biz-1', FULL));
  assert.ok(sb.attempts.length <= MIGRATION_GATED_COLUMNS.length + 1,
    `made ${sb.attempts.length} attempts`);
});

test('the proof path uses the shared helper rather than its own retry', async () => {
  const { readFileSync } = await import('node:fs');
  // Resolved from this file, not cwd — the suite is run from both the repo
  // root and apps/web. The writes moved out of the route into the module the
  // Mini App and the bot chat both call.
  const src = readFileSync(
    new URL('../paymentProof.js', import.meta.url), 'utf8');
  assert.ok(src.includes('updateBusinessTolerantly'), 'proof path should import the shared helper');
  assert.ok(!/\{\s*payment_submitted_at,\s*\.\.\.rest\s*\}/.test(src),
    'proof path should not carry its own hardcoded single-column retry');
});
