/**
 * GET /api/referral
 *
 * Returns the authenticated owner's referral link + earned credits for the
 * "give 30%, get 30%" cards on the success screen and Billing.
 * Mints the referral_code lazily on first request.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { getOrCreateReferralCode, listReferralCredits } from '../../../lib/server/referrals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHARED_BOT = 'MiniMeAgentBot';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'no_business' }, { status: 404 });

  const code = await getOrCreateReferralCode(business.id);
  if (!code) {
    // Schema not migrated yet — degrade gracefully, UI hides the card.
    return NextResponse.json({ ok: false, error: 'unavailable' });
  }

  const link = `https://t.me/${SHARED_BOT}?startapp=ref_${code}`;
  const credits = await listReferralCredits(business.id);
  return NextResponse.json({ ok: true, code, link, credits });
}
