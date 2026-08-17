import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_LIFECYCLE_STATES, isAwaitingDecision, PAYMENT_LIFECYCLE_LABELS,
} from '../../paymentLifecycle.js';

test('the vocabulary is closed and ordered by progress', () => {
  assert.deepEqual(PAYMENT_LIFECYCLE_STATES,
    ['awaiting_proof', 'in_review', 'verifying', 'rejected']);
});

test('every state has a label and a hint', () => {
  for (const s of PAYMENT_LIFECYCLE_STATES) {
    assert.ok(PAYMENT_LIFECYCLE_LABELS[s]?.label, `${s} has no label`);
    assert.ok(PAYMENT_LIFECYCLE_LABELS[s]?.hint, `${s} has no hint`);
  }
});

test('only in_review and verifying need a decision', () => {
  assert.equal(isAwaitingDecision({ payment_state: 'in_review' }), true);
  assert.equal(isAwaitingDecision({ payment_state: 'verifying' }), true);
  assert.equal(isAwaitingDecision({ payment_state: 'awaiting_proof' }), false);
  assert.equal(isAwaitingDecision({ payment_state: 'rejected' }), false);
});

test('a row with no payment activity is not awaiting anything', () => {
  // Rows predating the column read as null, which must never queue for review.
  assert.equal(isAwaitingDecision({}), false);
  assert.equal(isAwaitingDecision({ payment_state: null }), false);
  assert.equal(isAwaitingDecision(null), false);
});
