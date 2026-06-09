/**
 * POST /api/onboarding/reset
 *
 * Reopens the onboarding gate so the owner re-enters the signup wizard on their
 * next open ("start fresh / start as a new signup").
 *
 * NON-DESTRUCTIVE: products, conversations, orders and settings are all kept —
 * only the onboarding flags are cleared. In a Telegram mini-app you can't truly
 * "log out" (identity == Telegram account), so "new signup" means re-running the
 * wizard, not deleting the business.
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
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const business = await findByOwnerTelegramId(tg.id);
  if (!business) return NextResponse.json({ ok: true, business: null });

  // needsOnboarding() is true when there's no linked bot username AND
  // onboarding_completed is false — so clear both to reopen the wizard.
  const updated = await updateBusiness(business.id, {
    onboarding_completed: false,
    telegram_bot_username: null,
    bot_mode: null,
  });

  return NextResponse.json({ ok: true, business: updated || business });
}
