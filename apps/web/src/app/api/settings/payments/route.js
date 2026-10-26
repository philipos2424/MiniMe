/**
 * GET/POST /api/settings/payments — payment-method toggles.
 * Stored in businesses.notification_prefs.payments
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, update as updateBusiness } from '../../../../lib/server/businesses';
import {
  isValidStarsPerEtb, normalizeStarsPerEtb, etbPerStar, MIN_STARS_PER_ETB, MAX_STARS_PER_ETB,
} from '../../../../lib/starsRate.mjs';

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

  if (body.telegram_stars && !isValidStarsPerEtb(body.stars_per_etb)) {
    return NextResponse.json({
      error: `1 Star must be worth between ${etbPerStar(MAX_STARS_PER_ETB)} and ${etbPerStar(MIN_STARS_PER_ETB)} ETB.`,
    }, { status: 400 });
  }

  const payments = {
    chapa: !!body.chapa,
    telegram_stars: !!body.telegram_stars,
    stars_per_etb: normalizeStarsPerEtb(body.stars_per_etb),
    cbe_manual: !!body.cbe_manual,
    cbe_account: typeof body.cbe_account === 'string' ? body.cbe_account.trim().slice(0, 32) : '',
    cbe_name: typeof body.cbe_name === 'string' ? body.cbe_name.trim().slice(0, 100) : '',
    cbe_phone: typeof body.cbe_phone === 'string' ? body.cbe_phone.trim().slice(0, 32) : '',
    telebirr_manual: !!body.telebirr_manual,
    telebirr_phone: typeof body.telebirr_phone === 'string' ? body.telebirr_phone.trim().slice(0, 32) : '',
    telebirr_name: typeof body.telebirr_name === 'string' ? body.telebirr_name.trim().slice(0, 100) : '',
  };
  const prefs = { ...(business.notification_prefs || {}), payments };
  const updated = await updateBusiness(business.id, { notification_prefs: prefs });
  return NextResponse.json({ ok: true, payments: updated?.notification_prefs?.payments || payments });
}
