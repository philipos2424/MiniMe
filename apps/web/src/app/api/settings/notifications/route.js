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
    silent_drafts: business.notification_prefs?.silent_drafts ?? true,
  });
}

export async function POST(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  const morning_summary = {
    enabled: !!body.enabled,
    hour: clampHour(body.hour, 8),
    format: ['brief', 'detailed'].includes(body.format) ? body.format : 'brief',
  };

  const prefs = { ...(business.notification_prefs || {}), morning_summary };
  if (typeof body.silent_drafts === 'boolean') prefs.silent_drafts = body.silent_drafts;

  const updated = await updateBusiness(business.id, { notification_prefs: prefs });
  return NextResponse.json({
    ok: true,
    morning_summary: updated?.notification_prefs?.morning_summary || morning_summary,
    silent_drafts: updated?.notification_prefs?.silent_drafts ?? prefs.silent_drafts,
  });
}

function clampHour(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 23) return fallback;
  return Math.floor(n);
}
