/**
 * Social proof for the paywall — a LIVE, EXACT count of businesses signed up.
 *
 * In a market where owners have been burned by Telegram scams, "1,999 birr a
 * month" from an app they met three weeks ago is a trust question before it is
 * a value question. A true, checkable "N businesses already use this" does more
 * work than any feature bullet.
 *
 * Design notes, deliberately:
 *
 *  1. EVERY number is a live COUNT query. Nothing here is a constant a marketer
 *     can nudge upward — the moment one figure is invented, none of the rest are
 *     evidence any more. If you are tempted to hardcode a bigger number: don't.
 *     Ship the real one or ship no badge.
 *  2. The count is EXACT, not rounded. An earlier version rounded down so an
 *     "N+" claim could never overstate — but a rounded number cannot tick, and
 *     an exact one can't overstate either, because it's just the truth. "312
 *     businesses" also reads as a real count where "300+" reads as marketing.
 *  3. Below MIN_SIGNUPS the module returns null and the UI renders NOTHING.
 *     Weak proof ("7 businesses!") is worse than silence, and the honest fix is
 *     to say nothing rather than to inflate.
 */
import { supabase } from './db.js';

// Below this we say nothing at all rather than show unimpressive proof.
// Lower it if you'd rather show a small real number than no number — but never
// raise the number itself to clear the bar.
const MIN_SIGNUPS = 10;
// Same idea for the reply counter: substantial or absent.
const MIN_REPLIES = 500;
// "3 shops like yours" is proof; "1 shop like yours" is the opposite. Below
// this the peer line falls back a rung (category+city → city → nothing).
const MIN_PEERS = 3;

// Peer counts are per (category, city) and barely move — a long window is fine
// and keeps arbitrary query params from turning into a DB amplifier.
const PEERS_TTL_MS = 30 * 60 * 1000;
const peersCache = new Map(); // key → { at, value }

// Two different windows, because the two counts cost wildly different amounts.
//
// SIGNUPS is a count over `businesses` — a few hundred rows, milliseconds. It
// is the number owners watch, so it stays genuinely live; the window exists
// only to collapse the burst when a paywall mounts several components at once.
//
// REPLIES is a filtered count over `messages`, which is the biggest table in
// the system. Even with the partial index from migration 036 it is orders of
// magnitude more expensive, and nobody needs a lifetime total accurate to the
// second. Recomputing it every 15s on the paywall's render path would put a
// scan of `messages` in front of every upgrade view.
const SIGNUPS_TTL_MS = 15 * 1000;
const REPLIES_TTL_MS = 10 * 60 * 1000;

let signupsCache = null; // { at, value }
let repliesCache = null; // { at, value }

/**
 * Live platform numbers, or null when there isn't enough to be worth showing.
 * Never throws — a stats failure must not break a paywall.
 *
 * `signups` counts every business that has signed up, onboarded or not.
 *
 * @returns {Promise<{signups:number, replies:number|null}|null>}
 */
export async function getSocialProof() {
  const now = Date.now();
  const sb = supabase();
  if (!sb) return fromCaches();

  // ── Signups: live ──────────────────────────────────────────────────────────
  if (!signupsCache || now - signupsCache.at >= SIGNUPS_TTL_MS) {
    try {
      const { count } = await sb.from('businesses').select('id', { count: 'exact', head: true });
      signupsCache = { at: now, value: Number(count) || 0 };
    } catch (e) {
      console.warn('[socialProof] signups failed:', e.message);
      // Keep the last good value rather than dropping the badge mid-session.
    }
  }

  // ── Replies: refreshed on its own, much slower clock ───────────────────────
  if (!repliesCache || now - repliesCache.at >= REPLIES_TTL_MS) {
    try {
      const { count } = await sb.from('messages').select('id', { count: 'exact', head: true })
        .eq('is_ai_generated', true).eq('direction', 'outbound');
      repliesCache = { at: now, value: Number(count) || 0 };
    } catch (e) {
      console.warn('[socialProof] replies failed:', e.message);
      // A slow or failed count here must not take the signup number down with
      // it — the badge still renders with just the headline figure.
      repliesCache = repliesCache || { at: now, value: 0 };
    }
  }

  return fromCaches();
}

function fromCaches() {
  const signups = signupsCache?.value ?? 0;
  if (signups < MIN_SIGNUPS) return null;
  const replies = repliesCache?.value ?? 0;
  return { signups, replies: replies >= MIN_REPLIES ? replies : null };
}

// PostgREST treats these as filter syntax; strip before interpolating.
function clean(s) {
  return String(s || '').replace(/[%,()*]/g, ' ').trim().slice(0, 60);
}

async function countBusinesses(build) {
  const sb = supabase();
  if (!sb) return 0;
  const { count } = await build(sb.from('businesses').select('id', { count: 'exact', head: true }));
  return Number(count) || 0;
}

async function cachedCount(key, build) {
  const hit = peersCache.get(key);
  if (hit && Date.now() - hit.at < PEERS_TTL_MS) return hit.value;
  const value = await countBusinesses(build);
  // Bound the map so a hostile or buggy caller can't grow it without limit.
  if (peersCache.size > 200) peersCache.clear();
  peersCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * "Shops like yours, near you" — the proof that actually moves a shop owner.
 *
 * 800 strangers is a statistic. Fourteen cosmetics shops in Addis are the
 * competition, and that lands completely differently.
 *
 * Falls back a rung at a time rather than ever printing an embarrassing
 * number: category+city → city → nothing (the caller then shows the national
 * figure). MIN_PEERS is what stops "1 shop like yours" reaching a paywall.
 *
 * @returns {Promise<{count:number, scope:'category_city'|'city', category?:string, city:string}|null>}
 */
export async function getPeerProof({ category, city } = {}) {
  const cat = clean(category);
  const loc = clean(city);
  if (!loc) return null;

  try {
    if (cat) {
      const n = await cachedCount(`cc:${cat.toLowerCase()}:${loc.toLowerCase()}`, q =>
        q.ilike('category', cat).ilike('location', `%${loc}%`));
      if (n >= MIN_PEERS) return { count: n, scope: 'category_city', category: cat, city: loc };
    }
    const n = await cachedCount(`c:${loc.toLowerCase()}`, q => q.ilike('location', `%${loc}%`));
    if (n >= MIN_PEERS) return { count: n, scope: 'city', city: loc };
    return null;
  } catch (e) {
    console.warn('[socialProof] peers failed:', e.message);
    return null;
  }
}
