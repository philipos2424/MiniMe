/**
 * GET/POST /api/settings/notifications
 * Manages morning summary push notification settings.
 * Stored in businesses.notification_prefs.morning_summary
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, update as updateBusiness } from '../../../../lib/server/businesses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolve(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findByOwnerTelegramId(tg.id) : null;
}

export async function GET(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({
    morning_summary: business.notification_prefs?.morning_summary || null,
    // notifyOwnerDraft only goes quiet on an explicit true. This used to report
    // `?? true`, so owners who never chose saw "Only important" selected while
    // every message was pinging them.
    silent_drafts: business.notification_prefs?.silent_drafts === true,
  });
}

/**
 * Morning Digest and Notifications are separate pages now, so each save only
 * touches the fields it sends: a Notifications save must not reset the digest
 * (this always rewrote morning_summary, defaulting enabled to false).
 */
export async function POST(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  const prefs = { ...(business.notification_prefs || {}) };
  if ('enabled' in body || 'hour' in body || 'format' in body) {
    const cur = prefs.morning_summary || {};
    prefs.morning_summary = {
      enabled: 'enabled' in body ? !!body.enabled : cur.enabled !== false,
      hour: clampHour('hour' in body ? body.hour : cur.hour, 8),
      format: ['brief', 'detailed'].includes(body.format) ? body.format : (cur.format || 'brief'),
    };
  }
  if (typeof body.silent_drafts === 'boolean') prefs.silent_drafts = body.silent_drafts;

  const updated = await updateBusiness(business.id, { notification_prefs: prefs });
  return NextResponse.json({
    ok: true,
    morning_summary: updated?.notification_prefs?.morning_summary || prefs.morning_summary || null,
    silent_drafts: (updated?.notification_prefs?.silent_drafts ?? prefs.silent_drafts) === true,
  });
}

function clampHour(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 23) return fallback;
  return Math.floor(n);
}
