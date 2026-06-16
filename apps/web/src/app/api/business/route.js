/**
 * GET /api/business — return the caller's own business row (full record).
 *
 * The dashboard's anon key can't read `businesses` after the RLS lockdown.
 * Settings screens that need fresh fields (logo_url, tagline, ratings,
 * search_public_info, notification_prefs, …) fetch them here. Writes go through
 * /api/business/update.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'no_business' }, { status: 404 });

  return NextResponse.json({ business });
}
