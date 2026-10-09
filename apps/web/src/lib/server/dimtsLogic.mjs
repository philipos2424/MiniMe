/**
 * Pure helpers for the Dimts link (no I/O, unit-tested).
 *
 * Dimts and MiniMe sign each request to the other with a shared secret in the
 * Standard Webhooks format (webhook-id / webhook-timestamp / webhook-signature),
 * the same format Dimts already verifies for Polar.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const WAIT_DAYS = 14;

function keyOf(secret) {
  return secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret, 'utf8');
}

export function signBody(secret, id, timestamp, body) {
  const mac = createHmac('sha256', keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${mac}`;
}

/** Throws on any mismatch; never says which part failed. */
export function verifySignature({ body, id, timestamp, signature }, secret, now = Date.now()) {
  const fail = () => { throw new Error('Invalid signature'); };
  if (!secret || typeof body !== 'string' || !id || !timestamp || !signature) fail();
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(now / 1000 - seconds) > 300) fail();
  const expected = Buffer.from(signBody(secret, id, timestamp, body).slice(3), 'base64');
  const ok = signature.split(' ').filter(p => p.startsWith('v1,'))
    .some(p => { const c = Buffer.from(p.slice(3), 'base64'); return c.length === expected.length && timingSafeEqual(c, expected); });
  if (!ok) fail();
}

const digits = value => String(value ?? '').replace(/\D/g, '');

/**
 * Do two phone numbers name the same line? Telegram shares numbers in full
 * international form (251911...), owners sometimes type the national form
 * (0911...). A wrong match would send someone's message to a stranger, so
 * anything else is "no".
 */
export function samePhone(a, b) {
  const x = digits(a), y = digits(b);
  if (x.length < 8 || y.length < 8) return false;
  if (x === y) return true;
  const [national, intl] = x.startsWith('0') ? [x, y] : y.startsWith('0') ? [y, x] : [null, null];
  if (!national || intl.startsWith('0')) return false;
  const local = national.slice(1);
  return local.length >= 8 && intl.length > local.length && intl.endsWith(local);
}

/** Last seven digits, to narrow a database search before samePhone decides. */
export const phoneTail = phone => digits(phone).slice(-7);

/** Validate Dimts' send request; returns a clean object or throws. */
export function parseSendRequest(input) {
  const str = (v, max, required = true) => {
    if (v == null || v === '') { if (required) throw new Error('invalid_request'); return ''; }
    if (typeof v !== 'string' || v.length > max) throw new Error('invalid_request');
    return v.trim();
  };
  if (!input || typeof input !== 'object') throw new Error('invalid_request');
  const phone = str(input.phone, 32);
  if (!/^\+\d{8,15}$/.test(phone)) throw new Error('invalid_request');
  return {
    send_id: str(input.send_id, 100),
    user_id: str(input.user_id, 100),
    phone,
    caller_name: str(input.caller_name, 120, false),
    request: str(input.request, 500),
    draft: str(input.draft, 2000),
    language: ['en', 'am'].includes(input.language) ? input.language : 'en',
  };
}
