/**
 * verify.et response handling and the accept/reject decision — pure functions,
 * no network, no database.
 *
 * Split out for the same reason as llmPricing.mjs: verifyEt.js imports the
 * Supabase-backed settings module, which `node --test` cannot resolve. This is
 * the logic that decides whether somebody gets a paid product for free, so it
 * is the part that must be covered by tests.
 */

/** Map our internal payment method names onto verify.et's `bank` values. */
export function bankForMethod(method) {
  const m = String(method || '').toLowerCase();
  if (m.startsWith('telebirr')) return 'telebirr';
  if (m.startsWith('bank') || m.startsWith('cbe')) return 'cbe';
  return null;
}

/**
 * Flatten verify.et's response into the handful of facts a payment decision
 * needs. Their payload nests differently between the sync body, the status
 * endpoint and the webhook, so every reader goes through here.
 */
export function normalise(body) {
  if (!body) return { ok: false, state: 'error', reason: 'empty_response' };

  const v = body.verification || body.data?.verification || {};
  const tx = Array.isArray(body.data) ? (body.data[0] || {}) : (body.data || {});
  // The webhook (verification.completed) puts processingStatus/status/verified
  // directly on `data`, where the sync response nests them under
  // `verification`. Reading only the latter made every webhook-delivered
  // success parse as 'failed' — i.e. a merchant who really paid, whose
  // verification happened to run slow, would have been rejected.
  const processing = v.processingStatus || body.processingStatus || tx.processingStatus || null;
  const status = v.status || body.status || tx.status || null;
  const verified = v.verified === true || body.verified === true || tx.verified === true || status === 'verified';

  const settlement = tx.settlement || tx.settlementAccount || body.settlement || {};

  let state;
  if (processing && processing !== 'completed') state = 'queued';
  else if (verified && (status === 'success' || status === 'verified' || !status)) state = 'verified';
  else if (status === 'pending') state = 'pending';
  else state = 'failed';

  return {
    ok: true,
    state,
    verified,
    status,
    processingStatus: processing,
    amount: tx.amount != null ? Number(tx.amount) : null,
    sender: tx.sender || tx.payer || null,
    provider: tx.provider || tx.bank || null,
    // Settlement match — did the money reach OUR account?
    matched: settlement.matched ?? null,
    matchType: settlement.matchType || null,
    matchConfidence: settlement.matchConfidence || null,
    matchReason: settlement.reason || null,
    requestId: body.requestId || null,
    raw: body,
  };
}

/**
 * The accept/reject decision.
 *
 * Accepts only when the transaction verified, the amount covers the plan, and
 * the settlement account matched with usable confidence. `matched === null`
 * (verify.et couldn't tell) is NOT treated as a match — an unknown recipient is
 * exactly the case this integration exists to catch: a genuine receipt for a
 * payment made to somebody else is still a genuine receipt.
 *
 * `retryable` separates "we couldn't check" from "we checked and it's wrong",
 * so the caller can queue the first for another attempt and route the second
 * straight to human review.
 */
export function decide(result, { expectedEtb, amountToleranceEtb = 5, requireSettlementMatch = true } = {}) {
  if (!result?.ok) return { accept: false, reason: result?.reason || 'verifier_error', retryable: true };
  if (result.state === 'queued') return { accept: false, reason: 'queued', retryable: true };
  if (result.state === 'pending') return { accept: false, reason: 'bank_pending', retryable: true };
  if (result.state !== 'verified') return { accept: false, reason: 'not_verified', retryable: false };

  if (expectedEtb != null) {
    // Explicit null check first: Number(null) is 0, which is finite, so a
    // missing amount would otherwise be reported as "paid 0, short by 1999"
    // instead of "the verifier told us nothing about the amount".
    if (result.amount == null) return { accept: false, reason: 'no_amount', retryable: false };
    const paid = Number(result.amount);
    if (!Number.isFinite(paid)) return { accept: false, reason: 'no_amount', retryable: false };
    // Tolerance absorbs bank charges shaving a few birr off the transfer.
    if (paid + amountToleranceEtb < Number(expectedEtb)) {
      return { accept: false, reason: 'amount_short', retryable: false, paid, expected: Number(expectedEtb) };
    }
  }

  if (requireSettlementMatch) {
    if (result.matched !== true) return { accept: false, reason: 'recipient_unmatched', retryable: false };
    if (result.matchConfidence === 'low' || result.matchConfidence === 'none') {
      return { accept: false, reason: 'recipient_low_confidence', retryable: false };
    }
  }

  return { accept: true, reason: 'verified' };
}

/** Human-readable reasons, reused by the admin UI and the owner's Telegram message. */
export const REASON_TEXT = {
  no_api_key: 'verify.et is not configured',
  invalid_key: 'verify.et rejected our API key',
  no_credits: 'verify.et account is out of credits',
  no_permission: 'API key lacks the verification:write scope',
  idempotency_conflict: 'this reference was already submitted with different details',
  invalid_payload: 'the bank rejected the reference format',
  rate_limited: 'verify.et rate limit hit',
  unreachable: 'could not reach verify.et',
  verifier_error: 'the verification service could not be reached',
  missing_bank_suffix: 'no CBE account suffix configured — cannot verify bank transfers',
  missing_reference: 'no bank transaction number provided',
  unsupported_method: 'payment method not supported by verify.et',
  queued: 'verification is still running',
  bank_pending: 'the bank reports this transaction as still pending',
  not_verified: 'the bank could not confirm this transaction',
  no_amount: 'verify.et returned no amount for this transaction',
  amount_short: 'the amount paid is less than the plan price',
  recipient_unmatched: 'the money did not go to our account',
  recipient_low_confidence: 'could not confirm the money reached our account',
  verified: 'verified',
};
