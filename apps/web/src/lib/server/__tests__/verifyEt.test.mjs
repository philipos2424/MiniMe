/**
 * verify.et response parsing and the accept/reject rule.
 *
 * This decides whether a merchant gets a 1,999 ETB product for free, so the
 * cases that matter most are the ones where something looks almost right: a
 * real receipt paid to the wrong account, a short payment, a transaction the
 * bank hasn't settled yet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, decide, bankForMethod } from '../verifyEtDecision.mjs';

const PRICE = 1999;

/** A fully good verify.et sync response. */
const goodBody = (over = {}) => ({
  success: true,
  requestId: 'req-1',
  verification: { processingStatus: 'completed', status: 'success', verified: true },
  data: [{
    amount: PRICE,
    sender: 'Abebe Kebede',
    provider: 'telebirr',
    settlement: { matched: true, matchType: 'exact_match', matchConfidence: 'high', reason: 'receiver_account_exact_match' },
    ...over,
  }],
});

test('method names map to verify.et bank values', () => {
  assert.equal(bankForMethod('telebirr'), 'telebirr');
  assert.equal(bankForMethod('telebirr_manual'), 'telebirr');
  assert.equal(bankForMethod('bank'), 'cbe');
  assert.equal(bankForMethod('bank_manual'), 'cbe');
  assert.equal(bankForMethod('cbe'), 'cbe');       // older clients still send this
  assert.equal(bankForMethod('stripe'), null);
  assert.equal(bankForMethod(undefined), null);
});

test('a clean verified payment is accepted', () => {
  const r = normalise(goodBody());
  assert.equal(r.state, 'verified');
  assert.equal(r.amount, PRICE);
  assert.equal(r.matched, true);
  assert.deepEqual(decide(r, { expectedEtb: PRICE }), { accept: true, reason: 'verified' });
});

test('a real receipt paid to someone else is REJECTED', () => {
  // The whole point of the integration: the transaction genuinely exists, the
  // amount is right, but the money never reached us.
  const r = normalise(goodBody({
    settlement: { matched: false, matchType: 'unmatched', matchConfidence: 'none' },
  }));
  assert.equal(r.state, 'verified', 'the transaction itself is real');
  const d = decide(r, { expectedEtb: PRICE });
  assert.equal(d.accept, false);
  assert.equal(d.reason, 'recipient_unmatched');
  assert.equal(d.retryable, false, 'wrong recipient is settled fact, not worth retrying');
});

test('an unknown recipient is not treated as a match', () => {
  // matched: null means verify.et could not tell. Silence is not consent.
  const body = goodBody();
  delete body.data[0].settlement;
  const r = normalise(body);
  assert.equal(r.matched, null);
  assert.equal(decide(r, { expectedEtb: PRICE }).reason, 'recipient_unmatched');
});

test('low-confidence recipient matches are rejected', () => {
  const r = normalise(goodBody({
    settlement: { matched: true, matchType: 'suffix_match', matchConfidence: 'low' },
  }));
  assert.equal(decide(r, { expectedEtb: PRICE }).reason, 'recipient_low_confidence');
});

test('underpayment is rejected, small bank charges are tolerated', () => {
  const short = normalise(goodBody({ amount: 1000 }));
  const d = decide(short, { expectedEtb: PRICE });
  assert.equal(d.accept, false);
  assert.equal(d.reason, 'amount_short');
  assert.equal(d.paid, 1000);

  // 3 birr of charges shaved off should still pass the 5 birr tolerance.
  const nearly = normalise(goodBody({ amount: PRICE - 3 }));
  assert.equal(decide(nearly, { expectedEtb: PRICE }).accept, true);

  // Overpaying is fine.
  const over = normalise(goodBody({ amount: PRICE * 2 }));
  assert.equal(decide(over, { expectedEtb: PRICE }).accept, true);
});

test('queued and pending are retryable, not failures', () => {
  const queued = normalise({
    requestId: 'req-2',
    verification: { processingStatus: 'running', status: null, verified: false },
    data: [],
  });
  assert.equal(queued.state, 'queued');
  const dq = decide(queued, { expectedEtb: PRICE });
  assert.equal(dq.accept, false);
  assert.equal(dq.retryable, true, 'still running — must not be rejected outright');

  const pending = normalise({
    verification: { processingStatus: 'completed', status: 'pending', verified: false },
    data: [{ amount: PRICE }],
  });
  assert.equal(pending.state, 'pending');
  assert.equal(decide(pending, { expectedEtb: PRICE }).retryable, true);
});

test('a failed verification is rejected and not retried', () => {
  const r = normalise({
    verification: { processingStatus: 'completed', status: 'failed', verified: false },
    data: [],
  });
  assert.equal(r.state, 'failed');
  const d = decide(r, { expectedEtb: PRICE });
  assert.equal(d.accept, false);
  assert.equal(d.reason, 'not_verified');
  assert.equal(d.retryable, false);
});

test('transport errors are retryable and never accepted', () => {
  for (const reason of ['unreachable', 'no_credits', 'rate_limited', 'invalid_key']) {
    const d = decide({ ok: false, state: 'error', reason }, { expectedEtb: PRICE });
    assert.equal(d.accept, false, `${reason} must not grant access`);
    assert.equal(d.retryable, true, `${reason} should be retried, not rejected`);
    assert.equal(d.reason, reason);
  }
  // An empty/garbled body must not squeak through either.
  assert.equal(decide(normalise(null), { expectedEtb: PRICE }).accept, false);
  assert.equal(decide(undefined, { expectedEtb: PRICE }).accept, false);
});

test('verified with no amount reported is rejected', () => {
  const body = goodBody();
  delete body.data[0].amount;
  const r = normalise(body);
  assert.equal(decide(r, { expectedEtb: PRICE }).reason, 'no_amount');
});

test('webhook payload shape parses the same as the sync body', () => {
  // The webhook nests the verdict under data rather than returning an array.
  const r = normalise({
    event: 'verification.completed',
    requestId: 'req-3',
    data: {
      processingStatus: 'completed', status: 'success', verified: true,
      amount: PRICE, provider: 'cbe',
      settlement: { matched: true, matchConfidence: 'high' },
    },
  });
  assert.equal(r.state, 'verified');
  assert.equal(r.amount, PRICE);
  assert.equal(decide(r, { expectedEtb: PRICE }).accept, true);
});
