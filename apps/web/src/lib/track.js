'use client';
/**
 * Behavioural telemetry — the single client-side event primitive.
 *
 * Replaces the copy-pasted `logEvent` helpers (app/market/lib.js,
 * app/directory/DirectorySearch.js), each of which fired one un-batched request
 * per event with no session, no ordering and no retry.
 *
 * Contract, in priority order:
 *   1. NEVER break a flow. Every path here is wrapped; failures are swallowed.
 *      Telemetry that can throw is worse than no telemetry.
 *   2. NEVER carry PII. Callers pass structural descriptors and whitelisted meta
 *      keys only. The Mini App renders customer names, phones and message bodies
 *      on conversations/, customers/ and orders/ — a tracker that grabbed element
 *      text would pump that straight into an analytics table. /api/track scrubs
 *      again server-side, but the client is the first line.
 *   3. Batch. A Mini App on Ethiopian mobile data cannot afford one request per
 *      click, so events buffer and flush on size/idle/hide.
 */

const ENDPOINT = '/api/track';
const SID_KEY = 'mm_sid';
const SID_SEEN_KEY = 'mm_sid_last';
const SEQ_KEY = 'mm_sid_seq';
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 min without an event starts a new session
const FLUSH_SIZE = 10;
const FLUSH_IDLE_MS = 5000;
const MAX_BATCH = 50; // must stay <= the server's per-request cap

let queue = [];
let flushTimer = null;
let ctx = { surface: 'unknown', initData: null, businessId: null, tgUserId: null };

/** Configure identity/surface once the host provider knows them. Safe to re-call. */
export function configureTracking(next = {}) {
  ctx = { ...ctx, ...next };
}

function ss() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    // Telegram's in-app browser can throw on storage access in private modes.
    return null;
  }
}

function uuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  // RFC4122-shaped fallback — the column is UUID, so a malformed value would
  // fail the insert for the whole batch, not just this event.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Current session id, rolling over after SESSION_IDLE_MS of inactivity.
 * sessionStorage (not localStorage) so closing the Mini App ends the session,
 * which matches how owners actually use it: open from a Telegram notification,
 * do one thing, close.
 */
function sessionId() {
  const store = ss();
  if (!store) return (sessionId._mem ||= uuid()); // storage blocked — keep one id per page life
  const now = Date.now();
  let sid = null;
  try {
    sid = store.getItem(SID_KEY);
    const last = Number(store.getItem(SID_SEEN_KEY) || 0);
    if (!sid || !last || now - last > SESSION_IDLE_MS) {
      sid = uuid();
      store.setItem(SID_KEY, sid);
      store.setItem(SEQ_KEY, '0');
    }
    store.setItem(SID_SEEN_KEY, String(now));
  } catch {
    return (sessionId._mem ||= uuid());
  }
  return sid;
}

function nextSeq() {
  const store = ss();
  if (!store) return (nextSeq._mem = (nextSeq._mem || 0) + 1);
  try {
    const n = Number(store.getItem(SEQ_KEY) || 0) + 1;
    store.setItem(SEQ_KEY, String(n));
    return n;
  } catch {
    return (nextSeq._mem = (nextSeq._mem || 0) + 1);
  }
}

/** Meta is whitelisted by KEY here and re-validated by VALUE on the server. */
const META_KEYS = new Set(['q', 'category', 'via', 'ms', 'count', 'ok', 'kind', 'from', 'to', 'plan', 'source']);

function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!META_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 100);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Queue one event. `event` is the verb ('click'|'view'|'nav'|'submit'|'dwell'),
 * everything else is optional structure.
 */
export function track(event, { intent, route, target, meta, surface } = {}) {
  try {
    if (typeof window === 'undefined' || !event) return;
    queue.push({
      session_id: sessionId(),
      seq: nextSeq(),
      surface: surface || ctx.surface,
      event: String(event).slice(0, 40),
      intent: intent ? String(intent).slice(0, 120) : undefined,
      route: route ? String(route).slice(0, 200) : undefined,
      target: target ? String(target).slice(0, 120) : undefined,
      meta: cleanMeta(meta),
      occurred_at: new Date().toISOString(),
    });
    if (queue.length >= FLUSH_SIZE) flush();
    else scheduleFlush();
  } catch {
    // Never let instrumentation surface to the user.
  }
}

export const trackClick = (intent, opts) => track('click', { intent, ...opts });
export const trackView = (intent, opts) => track('view', { intent, ...opts });
export const trackNav = (route, opts) => track('nav', { route, ...opts });

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_IDLE_MS);
}

/**
 * Send whatever is buffered.
 * @param {boolean} final - use sendBeacon; the page is going away and fetch
 *   (even with keepalive) is not reliably delivered from a pagehide handler.
 */
export function flush(final = false) {
  try {
    if (!queue.length) return;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const events = queue.splice(0, MAX_BATCH);
    // A single burst can exceed one batch; keep the tail moving.
    if (queue.length) scheduleFlush();

    const payload = {
      surface: ctx.surface,
      business_id: ctx.businessId || undefined,
      tg_user_id: ctx.tgUserId || undefined,
      events,
    };
    const body = JSON.stringify(payload);

    // sendBeacon can't set the initData header, so unload batches arrive
    // unauthenticated. That's an accepted trade: losing the tail of every
    // session would bias every funnel toward people who never leave, and the
    // server still stamps what it can from the body.
    if (final && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (ctx.initData) headers['x-telegram-init-data'] = ctx.initData;
    fetch(ENDPOINT, { method: 'POST', headers, body, keepalive: true }).catch(() => {});
  } catch {}
}
