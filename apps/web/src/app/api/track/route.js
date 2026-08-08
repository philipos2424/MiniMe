/**
 * POST /api/track — behavioural event ingest (batched, fire-and-forget).
 *
 * Body: { surface, business_id?, tg_user_id?, events: [{ session_id, seq, event,
 *         intent?, route?, target?, meta?, occurred_at }] }
 *
 * Two trust levels:
 *   - Valid `x-telegram-init-data`  → identity is stamped SERVER-SIDE and the
 *     client's claimed business_id / tg_user_id are ignored entirely. This is
 *     what makes the Mini App funnels trustworthy: a forged body cannot
 *     attribute activity to someone else's business.
 *   - No/!valid header → accepted anonymously (public Market/Shop/Directory),
 *     same trust level as the existing /api/market/event route.
 *
 * Deliberately always 200. Telemetry must never break a user flow, and a client
 * that retried on error would amplify an outage into a stampede.
 *
 * The event vocabulary is intentionally open (no enum) — see ux_events.sql. The
 * safety property is enforced here instead, by SHAPE: hard length caps, a meta
 * key whitelist, and a PII scrub. The Mini App renders customer names, phone
 * numbers and message bodies; nothing resembling those may reach ux_events.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/server/db';
import { rateLimit, getIP } from '../../../lib/server/rateLimit';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { isAdmin } from '../../../lib/server/admin';
import { safeLabel, safeMeta, safeTimestamp } from '../../../lib/server/uxScrub.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_EVENTS = 50;
const SURFACES = new Set(['dashboard', 'market', 'directory', 'shop', 'onboarding']);
const EVENTS = new Set(['click', 'view', 'nav', 'submit', 'dwell', 'error']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request) {
  const ip = getIP(request);
  // 300/min vs market's 60 — batches carry up to 50 events each, so the per-user
  // request rate is far lower than the event rate.
  if (!rateLimit(ip, 'ux-event', 300, 60).ok) return NextResponse.json({ ok: true });

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) return NextResponse.json({ ok: true });
  // Reject rather than truncate: a silently dropped tail would corrupt `seq`
  // ordering in a way no query could detect afterwards.
  if (events.length > MAX_EVENTS) {
    return NextResponse.json({ error: 'too many events' }, { status: 400 });
  }

  // ---- identity -----------------------------------------------------------
  let tgUserId = null;
  let businessId = null;
  let verified = false;

  const initData = request.headers.get('x-telegram-init-data');
  if (initData && verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    const tg = parseTelegramUser(initData);
    if (tg?.id) {
      verified = true;
      tgUserId = String(tg.id);
      try {
        // Not `authenticate()` — that helper returns null when no business
        // exists, which would drop exactly the onboarding events we most need.
        const biz = await findBusinessForUser(tg.id);
        if (biz?.id) businessId = biz.id;
      } catch {
        // Identity is best-effort; an unattributed event beats a lost one.
      }
    }
  }

  if (!verified) {
    // Anonymous public surfaces. Accept the client's claims at the same (low)
    // trust level as /api/market/event, but keep them shape-checked.
    const claimedUser = String(body.tg_user_id || '');
    if (/^\d{1,32}$/.test(claimedUser)) tgUserId = claimedUser;
    if (UUID_RE.test(String(body.business_id || ''))) businessId = body.business_id;
  }

  // ---- staff exclusion ----------------------------------------------------
  // Platform admins are never recorded. Two reasons, and the second is why this
  // is a hard drop rather than a filter at read time:
  //   1. Correctness — we tap through every screen while testing, which would
  //      put whatever we last worked on at the top of the usage ranking. The
  //      whole point of the leaderboard is what OWNERS do.
  //   2. Consent — the row simply never exists, so there is nothing to leak,
  //      export or forget later. A read-time filter still stores it.
  // Enforced HERE, server-side, off the verified Telegram id: a client-side
  // opt-out would be lost the moment someone cleared storage or opened the app
  // on another device. Unload batches arrive via sendBeacon with no initData
  // header, so the unverified claim is checked too — it can only ever cause us
  // to discard more, never to record an admin.
  if (isAdmin(tgUserId)) return NextResponse.json({ ok: true });

  const surface = SURFACES.has(body.surface) ? body.surface : 'unknown';

  // ---- normalize ----------------------------------------------------------
  const rows = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (!UUID_RE.test(String(e.session_id || ''))) continue;
    const name = EVENTS.has(e.event) ? e.event : null;
    if (!name) continue;
    const seq = Number(e.seq);
    if (!Number.isInteger(seq) || seq < 0) continue;

    rows.push({
      session_id: e.session_id,
      seq,
      surface: SURFACES.has(e.surface) ? e.surface : surface,
      event: name,
      intent: safeLabel(e.intent, 120),
      route: safeLabel(e.route, 200),
      target: safeLabel(e.target, 120),
      business_id: businessId,
      tg_user_id: tgUserId,
      meta: safeMeta(e.meta),
      occurred_at: safeTimestamp(e.occurred_at),
    });
  }

  if (!rows.length) return NextResponse.json({ ok: true });

  try {
    const { error } = await supabase().from('ux_events').insert(rows);
    if (error) console.warn('[track] insert failed:', error.message);
  } catch (e) {
    console.warn('[track] insert threw:', e?.message);
  }

  return NextResponse.json({ ok: true });
}
