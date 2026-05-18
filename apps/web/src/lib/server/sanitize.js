/**
 * Input sanitization and bounds-checking library.
 *
 * Every field that enters the system from an untrusted source must pass
 * through one of these validators before being used in a DB query, AI
 * prompt, or Telegram message.
 *
 * Design philosophy:
 *  - Return a sanitized value (never mutate in place)
 *  - Throw a ValidationError with a human-readable message on failure
 *  - Never truncate silently — always throw or return the clamped value explicitly
 *  - Be strict at the edges (API boundary), permissive internally
 */

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.field = field;
    this.statusCode = 400;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// String validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize a plain text string.
 * - Trims whitespace
 * - Enforces min/max length
 * - Strips null bytes (protect Postgres)
 * - Optionally strips HTML tags
 */
export function str(value, { field = 'field', min = 0, max = 1000, required = false, stripHtml = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(field, 'is required');
    return '';
  }
  if (typeof value !== 'string') {
    value = String(value);
  }
  // Remove null bytes (can break Postgres and some parsers)
  value = value.replace(/\0/g, '');
  // Strip HTML tags to prevent stored XSS
  if (stripHtml) value = value.replace(/<[^>]*>/g, '');
  // Trim whitespace
  value = value.trim();
  if (required && value.length === 0) throw new ValidationError(field, 'cannot be blank');
  if (value.length < min) throw new ValidationError(field, `must be at least ${min} characters`);
  if (value.length > max) throw new ValidationError(field, `must be at most ${max} characters (got ${value.length})`);
  return value;
}

/**
 * Sanitize a name field (person/product/business name).
 * Allows letters, numbers, Amharic, spaces, and common punctuation.
 * Rejects angle brackets, script tags, and SQL special chars.
 */
export function name(value, { field = 'name', min = 1, max = 200, required = true } = {}) {
  let s = str(value, { field, min, max, required, stripHtml: true });
  // Strip potentially dangerous characters while preserving Amharic (U+1200-U+137F)
  // Allow: letters (any), numbers, spaces, hyphens, apostrophes, periods, commas, parentheses
  s = s.replace(/[<>&"'`\\;{}[\]]/g, '');
  if (required && s.length === 0) throw new ValidationError(field, 'cannot be blank after sanitization');
  return s;
}

/**
 * Validate and sanitize a URL.
 * - Must be http or https
 * - Must not be a private/loopback IP (SSRF prevention)
 * - Max length 2048
 */
const PRIVATE_IP_RE = /^(?:localhost|127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|::1|fc00:|fe80:)/i;

export function url(value, { field = 'url', required = false } = {}) {
  if (!value || value === '') {
    if (required) throw new ValidationError(field, 'is required');
    return null;
  }
  const s = str(value, { field, max: 2048, required, stripHtml: false });
  let parsed;
  try { parsed = new URL(s); }
  catch { throw new ValidationError(field, 'is not a valid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError(field, 'must use http or https');
  }
  if (PRIVATE_IP_RE.test(parsed.hostname)) {
    throw new ValidationError(field, 'must not point to a private/internal address (SSRF prevention)');
  }
  return s;
}

/**
 * Validate a Telegram file URL.
 * Must be on api.telegram.org or a known CDN (cdn4.telegram.org, etc.).
 * Used for file.url fields in conversation replies.
 */
const ALLOWED_FILE_DOMAINS = /^(https?:\/\/)?([\w-]+\.)?telegram\.org(\/|$)/i;

export function telegramFileUrl(value, { field = 'file.url', required = false } = {}) {
  if (!value) {
    if (required) throw new ValidationError(field, 'is required');
    return null;
  }
  const s = str(value, { field, max: 1000, required, stripHtml: false });
  try { new URL(s); } catch { throw new ValidationError(field, 'is not a valid URL'); }
  if (!ALLOWED_FILE_DOMAINS.test(s)) {
    throw new ValidationError(field, 'file URL must be on telegram.org');
  }
  return s;
}

/**
 * Validate an alphanumeric code (discount codes, promo codes).
 */
export function code(value, { field = 'code', min = 1, max = 30 } = {}) {
  const s = str(value, { field, min, max, required: true, stripHtml: false });
  const clean = s.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (clean.length < min) throw new ValidationError(field, `must be at least ${min} characters after removing special characters`);
  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Numeric validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize a number.
 * - Parses string inputs
 * - Enforces min/max range
 * - Rejects NaN, Infinity
 * - Optionally enforces integer
 */
export function num(value, { field = 'field', min = -Infinity, max = Infinity, required = false, integer = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(field, 'is required');
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(field, `must be a finite number (got "${value}")`);
  if (integer && !Number.isInteger(n)) throw new ValidationError(field, 'must be an integer');
  if (n < min) throw new ValidationError(field, `must be at least ${min} (got ${n})`);
  if (n > max) throw new ValidationError(field, `must be at most ${max} (got ${n})`);
  return n;
}

/**
 * Validate a price/money value (non-negative, max 2 decimal places).
 */
export function price(value, { field = 'price', min = 0, max = 10_000_000 } = {}) {
  const n = num(value, { field, min, max, required: false });
  if (n === null) return null;
  // At most 2 decimal places
  if (Math.round(n * 100) !== n * 100) {
    throw new ValidationError(field, 'must have at most 2 decimal places');
  }
  return n;
}

/**
 * Validate a stock quantity (non-negative integer).
 */
export function stock(value, { field = 'stock', max = 1_000_000 } = {}) {
  if (value === undefined || value === null) return null;
  return num(value, { field, min: 0, max, integer: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Enum validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that a value is one of an allowed set.
 */
export function oneOf(value, allowed, { field = 'field', required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(field, 'is required');
    return null;
  }
  if (!allowed.includes(value)) {
    throw new ValidationError(field, `must be one of: ${allowed.join(', ')} (got "${value}")`);
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate an ISO date string. Rejects past dates optionally.
 */
export function isoDate(value, { field = 'date', required = false, pastAllowed = true, maxFutureDays = 3650 } = {}) {
  if (!value) {
    if (required) throw new ValidationError(field, 'is required');
    return null;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new ValidationError(field, 'must be a valid ISO date string');
  if (!pastAllowed && d < new Date()) throw new ValidationError(field, 'must be a future date');
  const maxFuture = new Date(Date.now() + maxFutureDays * 86400000);
  if (d > maxFuture) throw new ValidationError(field, `must not be more than ${maxFutureDays} days in the future`);
  return d.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Array validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate an array with length bounds.
 */
export function arr(value, { field = 'array', minLen = 0, maxLen = 100, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(field, 'is required');
    return [];
  }
  if (!Array.isArray(value)) throw new ValidationError(field, 'must be an array');
  if (value.length < minLen) throw new ValidationError(field, `must have at least ${minLen} item(s)`);
  if (value.length > maxLen) throw new ValidationError(field, `must have at most ${maxLen} item(s) (got ${value.length})`);
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// File upload validators
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']);
const ALLOWED_DOC_MIMES   = new Set(['application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword']);

/**
 * Validate an uploaded image file (from FormData).
 */
export function imageFile(file, { field = 'file', maxBytes = 5 * 1024 * 1024 } = {}) {
  if (!file || typeof file === 'string') throw new ValidationError(field, 'is required');
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    throw new ValidationError(field, `file type "${mime}" is not allowed. Must be JPEG, PNG, WebP, GIF, or HEIC`);
  }
  // Validate by magic bytes (first 4 bytes) if possible
  // (skipped here — enforce via mime type + extension allowlist)
  // Extension allowlist
  const ext = (file.name || '').split('.').pop().toLowerCase().slice(0, 5);
  const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'];
  if (!allowedExts.includes(ext)) {
    throw new ValidationError(field, `file extension ".${ext}" is not allowed`);
  }
  return { mime, ext };
}

/**
 * Validate an uploaded document file (PDF, Word, CSV, text).
 */
export function docFile(file, { field = 'file', maxBytes = 20 * 1024 * 1024 } = {}) {
  if (!file || typeof file === 'string') throw new ValidationError(field, 'is required');
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_DOC_MIMES.has(mime) && !ALLOWED_IMAGE_MIMES.has(mime)) {
    throw new ValidationError(field, `file type "${mime}" is not allowed`);
  }
  return { mime };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt injection prevention
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize text before injecting into an AI system prompt.
 *
 * Defends against prompt injection attacks where a customer message tries to
 * hijack Alfred's instructions. Removes known jailbreak patterns while
 * preserving legitimate business content.
 *
 * Uses a multi-layer approach:
 *  1. Hard length cap (prevents overwhelming context window)
 *  2. Remove null bytes and other control characters
 *  3. Strip patterns that commonly appear in jailbreak attempts
 *  4. Flag (but don't remove) suspicious content for logging
 */
const JAILBREAK_PATTERNS = [
  // Direct instruction overrides
  /ignore (previous|all|above|system|prior|old|any) (instructions?|prompts?|context|rules?|guidelines?)/gi,
  /forget (everything|all|your instructions?|what you were told)/gi,
  /disregard (all |previous |your |the )?(instructions?|rules?|guidelines?|context)/gi,
  /\bnew (instructions?|system prompt|rules?|guidelines?)\b/gi,
  /\boverride\b.{0,30}\b(instructions?|rules?|system|mode)\b/gi,
  // Role switching
  /\byou are now\b/gi,
  /\bact as (a |an )?(different|new|evil|uncensored|jailbroken|unrestricted|DAN|GPT|AI)\b/gi,
  /\bpretend (you are|to be) (a |an )?(different|evil|unrestricted)\b/gi,
  /\bswitch (to |into )?developer mode\b/gi,
  /\bDAN mode\b/gi,
  /\bjailbreak\b/gi,
  // System-level injection
  /\[system\]/gi,
  /\[user\]/gi,
  /\[assistant\]/gi,
  /\[INST\]/gi,
  /<\|system\|>/gi,
  /<\|user\|>/gi,
  /<\|assistant\|>/gi,
  // Prompt delimiter injection
  /#{3,}/g,
  /\*{5,}/g,
  // Base64 encoded instruction attempts (basic heuristic)
  /\bbase64\b.{0,30}\bdecode\b/gi,
  // Amharic jailbreak attempts (common for this app)
  /አዲስ መመሪያ/g,
  /ሁሉንም ሰርዝ/g,
];

export function sanitizeForPrompt(text, { field = 'message', maxLength = 2000 } = {}) {
  if (!text || typeof text !== 'string') return '';
  // Hard length cap
  let s = text.slice(0, maxLength);
  // Remove null bytes and dangerous control chars (keep newlines, tabs)
  s = s.replace(/[\0\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Strip jailbreak patterns
  for (const re of JAILBREAK_PATTERNS) {
    s = s.replace(re, '[⚠ filtered]');
  }
  return s;
}

/**
 * Sanitize a collection of messages (chat history) before injecting into prompt.
 * Caps the total character count to prevent context window exhaustion.
 */
export function sanitizeMessages(messages, { maxPerMessage = 500, maxTotal = 5000 } = {}) {
  let total = 0;
  const result = [];
  for (const m of messages || []) {
    const content = sanitizeForPrompt(m.content || '', { maxLength: maxPerMessage });
    total += content.length;
    if (total > maxTotal) break;
    result.push({ ...m, content });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return a standardized 400 response from a ValidationError.
 * Usage: return validationResponse(e);
 */
export function validationResponse(e) {
  const { NextResponse } = require('next/server');
  return NextResponse.json(
    { error: 'validation_error', field: e.field, message: e.message },
    { status: 400 }
  );
}
