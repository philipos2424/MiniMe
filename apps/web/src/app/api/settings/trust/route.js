/**
 * POST /api/settings/trust  Body: { trust_level: 0|1|2|3 }
 * Owner can move trust level up or down. Capped at 0..3.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, update as updateBusiness } from '../../../../lib/server/businesses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  const next = Number(body.trust_level);
  if (!Number.isFinite(next) || next < 0 || next > 3) {
    return NextResponse.json({ error: 'trust_level must be 0..3' }, { status: 400 });
  }

  const updated = await updateBusiness(business.id, {
    trust_level: Math.floor(next),
    trust_promoted_at: next > (business.trust_level ?? 0) ? new Date().toISOString() : business.trust_promoted_at,
  });
  return NextResponse.json({ ok: true, business: updated || business });
}
