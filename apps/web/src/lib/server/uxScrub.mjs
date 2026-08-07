/**
 * PII scrub for behavioural telemetry (/api/track → ux_events).
 *
 * Split out of the route so it is directly testable: this is the one piece of
 * the tracking change whose failure mode is a privacy incident rather than a
 * missing chart. The client already omits PII — this exists because the client
 * is not trustworthy, and because a future `data-intent` typo (or a component
 * that interpolates a customer name into an id) must not be able to leak.
 *
 * Rules:
 *   - Structural fields are short. Anything long is prose, and prose is content.
 *   - Anything shaped like an email or phone number is DROPPED, not truncated —
 *     a truncated phone number is still a phone number.
 *   - meta is whitelisted by key AND validated by value.
 */

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// Ethiopian mobile numbers are commonly written +251 9xx xxx xxx, 09xx-xxx-xxx,
// or bare 9-digit strings, so the pattern deliberately tolerates spaces, dots,
// dashes and parens rather than matching only clean digits.
const PHONE_RE = /(?:\+|00)?\d[\d\s().-]{6,}\d/;

export const META_KEYS = new Set([
  'q', 'category', 'via', 'ms', 'count', 'ok', 'kind', 'from', 'to', 'plan', 'source',
]);

/** Returns the value if it is a safe structural label, else null. */
export function safeLabel(value, max) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > max) return null;
  if (EMAIL_RE.test(s) || PHONE_RE.test(s)) return null;
  return s;
}

export function safeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!META_KEYS.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') {
      const s = safeLabel(v, 100);
      if (s) out[k] = s;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Mini App devices frequently have a skewed wall clock, so client timestamps are
 * clamped to a sane window. Without this one bad handset can write rows dated
 * years out and quietly skew every date-range query built on this table.
 */
export function safeTimestamp(value, now = Date.now()) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return new Date(now).toISOString();
  if (t > now + 60 * 60 * 1000 || t < now - 7 * 24 * 60 * 60 * 1000) return new Date(now).toISOString();
  return new Date(t).toISOString();
}
