/**
 * POST /api/settings/email-waitlist
 * Saves the owner's email address for the upcoming email-integration waitlist.
 * Stored in businesses.meta.email_waitlist = { email, joined_at }
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
  if (!business) return NextResponse.json({ error: 'no business' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }

  await updateBusiness(business.id, {
    meta: { ...(business.meta || {}), email_waitlist: { email, joined_at: new Date().toISOString() } },
  });

  return NextResponse.json({ ok: true });
}
