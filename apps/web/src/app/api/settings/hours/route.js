/**
 * GET/POST /api/settings/hours — quiet hours config.
 * Stored in businesses.notification_prefs.dnd
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
  return NextResponse.json({ dnd: business.notification_prefs?.dnd || null });
}

export async function POST(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  const dnd = {
    enabled: !!body.enabled,
    start_hour: clampHour(body.start_hour, 22),
    end_hour: clampHour(body.end_hour, 8),
    mode: ['auto_reply', 'silent'].includes(body.mode) ? body.mode : 'auto_reply',
    message: typeof body.message === 'string' ? body.message.slice(0, 500) : null,
    timezone: 'Africa/Addis_Ababa',
  };

  const prefs = { ...(business.notification_prefs || {}), dnd };
  const updated = await updateBusiness(business.id, { notification_prefs: prefs });
  return NextResponse.json({ ok: true, dnd: updated?.notification_prefs?.dnd || dnd });
}

function clampHour(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 23) return fallback;
  return Math.floor(n);
}
