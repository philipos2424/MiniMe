/**
 * POST /api/onboarding/intake   Body: { text }
 *
 * The Mini App's "describe everything in one message": the same one-message
 * setup the bot uses (setupIntake.mjs). Reads what the owner wrote, adds the
 * products with prices, location, hours, delivery and payment number, and
 * returns what it set up so the wizard can show it and move to the preview.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { extractIntake, applyIntake } from '../../../../lib/server/setupIntakeRun';
import { intakeUseful, intakeMissing } from '../../../../lib/server/setupIntake.mjs';
import { rateLimit, getIP } from '../../../../lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const { ok: rl, retryAfter } = rateLimit(getIP(request), 'onboarding_intake', 6, 60);
  if (!rl) return NextResponse.json({ error: 'too_many_requests', retryAfter }, { status: 429 });
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const user = parseTelegramUser(initData);
  if (!user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const business = await findByOwnerTelegramId(user.id);
  if (!business) return NextResponse.json({ error: 'no_business' }, { status: 404 });

  let body = {};
  try { body = await request.json(); } catch {}
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
  if (text.length < 3) return NextResponse.json({ error: 'Tell me what you sell first.' }, { status: 400 });

  let intake;
  try { intake = await extractIntake(business, text); }
  catch (e) {
    console.warn('[onboarding/intake]', e.message);
    return NextResponse.json({ error: 'MiniMe couldn’t read that just now. Try again, or tap what you sell.' }, { status: 502 });
  }
  if (!intakeUseful(intake) || !intake.products.length) {
    return NextResponse.json({ error: 'I couldn’t find products with prices. Try like “Shiro 120, Tibs 350”.', intake }, { status: 422 });
  }
  await applyIntake(business, intake);
  return NextResponse.json({
    ok: true,
    products: intake.products,
    unpriced: intake.unpriced,
    location: intake.location, hours: intake.hours, delivery: intake.delivery,
    payment: !!(intake.telebirr || intake.cbe),
    missing: intakeMissing(intake),
  });
}
