/**
 * GET/POST /api/settings/payments — payment-method toggles.
 * Stored in businesses.notification_prefs.payments
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
  return NextResponse.json({ payments: business.notification_prefs?.payments || { chapa: true } });
}

export async function POST(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body = {};
  try { body = await request.json(); } catch {}

  const payments = {
    chapa: !!body.chapa,
    telegram_stars: !!body.telegram_stars,
    stars_per_etb: Math.max(0.1, Number(body.stars_per_etb) || 1),
    cbe_manual: !!body.cbe_manual,
    cbe_account: typeof body.cbe_account === 'string' ? body.cbe_account.trim().slice(0, 32) : '',
    cbe_name: typeof body.cbe_name === 'string' ? body.cbe_name.trim().slice(0, 100) : '',
    cbe_phone: typeof body.cbe_phone === 'string' ? body.cbe_phone.trim().slice(0, 32) : '',
  };
  const prefs = { ...(business.notification_prefs || {}), payments };
  const updated = await updateBusiness(business.id, { notification_prefs: prefs });
  return NextResponse.json({ ok: true, payments: updated?.notification_prefs?.payments || payments });
}
