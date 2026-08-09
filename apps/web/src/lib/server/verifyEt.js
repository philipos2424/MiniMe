/**
 * verify.et — Ethiopian bank/wallet transaction verification.
 *
 * Why this exists: until now "proof of payment" was a screenshot plus our own
 * reference code typed back to us. Checking `business.payment_ref === txRef`
 * only proves the merchant can read their own screen — it says nothing about
 * money moving. Monthly plans auto-activated on that basis, so Pro was
 * effectively free to anyone willing to upload any image.
 *
 * verify.et checks the reference against the bank and returns the amount,
 * status and — given a settlement account — whether the money landed in OUR
 * account. That last part is the one that matters: a genuine receipt for a
 * payment made to somebody else is still a genuine receipt.
 *
 * API contract (https://verify.et/docs/api):
 *   POST /api/verify?waitMs=<n>   x-api-key, Idempotency-Key, x-webhook-url
 *     CBE      → { bank:'cbe',      referenceNumber, accountSuffix(8 digits) }
 *     Telebirr → { bank:'telebirr', transactionNumber, settlementAccount? }
 *     200 = completed, 202 = queued (poll statusUrl or await webhook)
 *   GET  /api/verify/:requestId   → processingStatus, status, verified
 *   GET  /api/verify/history      → cheap authenticated read, used for ping()
 *   401 bad key · 402 out of credits · 409 idempotency reuse · 422 bad payload
 *   429 rate limited · 503 queue unavailable
 *
 * Everything here fails CLOSED but never silently: an unreachable verifier
 * returns ok:false with a reason so the caller can queue the payment for human
 * review, rather than either granting access or losing the payment.
 */
import { getSettings } from './platformSettings';
// Pure response-parsing and the accept/reject rule live in a dependency-free
// module so `node --test` can cover them (see __tests__/verifyEt.test.mjs).
import { bankForMethod, normalise, decide, REASON_TEXT } from './verifyEtDecision.mjs';

export { bankForMethod, normalise, decide, REASON_TEXT };

const BASE = process.env.VERIFY_ET_BASE_URL || 'https://verify.et';
const DEFAULT_WAIT_MS = 8000;   // give it a chance to answer inline before we queue
const REQUEST_TIMEOUT_MS = 15000;

/** Settings this integration needs. Returns nulls when unconfigured. */
export async function verifyEtConfig() {
  const s = await getSettings([
    'verifyet.api.key',
    'verifyet.webhook.secret',
    'payment.bank.suffix',
    'payment.telebirr.phone',
  ]);
  return {
    apiKey: s['verifyet.api.key'] || null,
    webhookSecret: s['verifyet.webhook.secret'] || null,
    bankSuffix: (s['payment.bank.suffix'] || '').replace(/\D/g, '') || null,
    telebirrAccount: s['payment.telebirr.phone'] || null,
  };
}

export async function isConfigured() {
  const { apiKey } = await verifyEtConfig();
  return !!apiKey;
}

/**
 * Cheap authenticated call used to check a key actually works, WITHOUT
 * spending a verification credit — /api/verify/history is a `verification:read`
 * endpoint, so a 200 proves the key is valid and has read scope.
 */
export async function ping() {
  const { apiKey } = await verifyEtConfig();
  if (!apiKey) return { ok: false, reason: 'no_api_key', message: 'No verify.et API key saved.' };

  try {
    const r = await fetch(`${BASE}/api/verify/history?limit=1`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (r.status === 401) return { ok: false, reason: 'invalid_key', message: 'verify.et rejected the key (401).' };
    if (r.status === 403) return { ok: false, reason: 'no_permission', message: 'Key lacks the verification:read scope (403).' };
    if (r.status === 402) return { ok: false, reason: 'no_credits', message: 'verify.et account is out of verification credits (402).' };
    if (r.status === 429) return { ok: false, reason: 'rate_limited', message: 'Rate limited by verify.et (429).' };
    if (!r.ok) return { ok: false, reason: 'http_' + r.status, message: `verify.et returned HTTP ${r.status}.` };
    const body = await r.json().catch(() => null);
    return {
      ok: true,
      message: 'Key is valid and verify.et is reachable.',
      recent_verifications: Array.isArray(body?.data) ? body.data.length : null,
    };
  } catch (e) {
    return { ok: false, reason: 'unreachable', message: `Could not reach verify.et: ${e.message}` };
  }
}

export async function verifyTransaction({
  method,
  reference,
  idempotencyKey,
  webhookUrl = null,
  waitMs = DEFAULT_WAIT_MS,
}) {
  const cfg = await verifyEtConfig();
  if (!cfg.apiKey) return { ok: false, state: 'error', reason: 'no_api_key' };

  const bank = bankForMethod(method);
  if (!bank) return { ok: false, state: 'error', reason: 'unsupported_method' };

  const ref = String(reference || '').trim();
  if (!ref) return { ok: false, state: 'error', reason: 'missing_reference' };

  // Per-bank payload. The settlement fields are what prove the money reached
  // US; we send them whenever they're configured and let verify.et report the
  // match rather than trying to compare masked account strings ourselves.
  let payload;
  if (bank === 'cbe') {
    if (!cfg.bankSuffix || cfg.bankSuffix.length !== 8) {
      // CBE verification is impossible without it — say so instead of sending
      // a request that will 422 and burn a credit.
      return { ok: false, state: 'error', reason: 'missing_bank_suffix' };
    }
    payload = { bank: 'cbe', referenceNumber: ref, accountSuffix: cfg.bankSuffix };
  } else {
    payload = { bank: 'telebirr', transactionNumber: ref };
    if (cfg.telebirrAccount) payload.settlementAccount = cfg.telebirrAccount;
  }

  const headers = {
    'x-api-key': cfg.apiKey,
    'content-type': 'application/json',
  };
  // Same merchant + same bank reference must never be charged twice, and a
  // retry after a timeout must not create a second verification.
  if (idempotencyKey) headers['idempotency-key'] = String(idempotencyKey).slice(0, 128);
  if (webhookUrl) headers['x-webhook-url'] = webhookUrl;

  let r, body;
  try {
    r = await fetch(`${BASE}/api/verify?waitMs=${encodeURIComponent(waitMs)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    body = await r.json().catch(() => null);
  } catch (e) {
    return { ok: false, state: 'error', reason: 'unreachable', message: e.message };
  }

  if (r.status === 401) return { ok: false, state: 'error', reason: 'invalid_key' };
  if (r.status === 402) return { ok: false, state: 'error', reason: 'no_credits' };
  if (r.status === 403) return { ok: false, state: 'error', reason: 'no_permission' };
  if (r.status === 409) return { ok: false, state: 'error', reason: 'idempotency_conflict' };
  if (r.status === 422) return { ok: false, state: 'error', reason: 'invalid_payload', raw: body };
  if (r.status === 429) return { ok: false, state: 'error', reason: 'rate_limited' };
  if (r.status === 503) {
    // Queue unavailable, but a status URL still exists — treat as queued so the
    // payment lands in review rather than being lost.
    return { ok: true, state: 'queued', requestId: body?.requestId || null, statusUrl: body?.statusUrl || null, raw: body };
  }
  if (!r.ok) return { ok: false, state: 'error', reason: 'http_' + r.status, raw: body };

  if (r.status === 202) {
    return {
      ok: true, state: 'queued',
      requestId: body?.requestId || null,
      statusUrl: body?.statusUrl || body?.links?.statusUrl || null,
      raw: body,
    };
  }

  return normalise(body);
}

/** Poll a queued verification. */
export async function fetchVerification(requestId) {
  const { apiKey } = await verifyEtConfig();
  if (!apiKey) return { ok: false, state: 'error', reason: 'no_api_key' };
  try {
    const r = await fetch(`${BASE}/api/verify/${encodeURIComponent(requestId)}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, state: 'error', reason: 'http_' + r.status, raw: body };
    return normalise(body);
  } catch (e) {
    return { ok: false, state: 'error', reason: 'unreachable', message: e.message };
  }
}
