/**
 * POST /api/onboarding/reset
 *
 * Reopens the onboarding gate so the owner re-enters the signup wizard on their
 * next open ("start fresh / start as a new signup").
 *
 * NON-DESTRUCTIVE: products, conversations, orders and settings are all kept —
 * only the onboarding flags are cleared. A live shop needs an explicit
 * { confirm: 'start_setup_again' } and keeps its bot_mode and bot username.
 * Sign out must never call this route. In a Telegram mini-app you can't truly
 * "log out" (identity == Telegram account), so "new signup" means re-running the
 * wizard, not deleting the business.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, update as updateBusiness } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { resetDecision, RESET_CONFIRM } from '../../../../lib/server/onboardingReset.mjs';

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

  // A live shop (customers, products or a linked bot) is only reopened with
  // an explicit confirm, and its routing fields are never cleared. See
  // lib/server/onboardingReset.mjs for why.
  let body = {};
  try { body = await request.json(); } catch {}
  const sb = supabase();
  const [{ count: conversationCount }, { count: productCount }] = await Promise.all([
    sb.from('conversations').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
  ]);
  const decision = resetDecision(business, {
    conversationCount: conversationCount || 0,
    productCount: productCount || 0,
    confirm: body?.confirm,
  });
  if (!decision.allowed) {
    return NextResponse.json({
      error: decision.reason,
      message: `Your shop is live, so setup can't be restarted without confirming. Send { "confirm": "${RESET_CONFIRM}" } to reopen setup; your bot and share link keep working.`,
    }, { status: 409 });
  }

  // Keep private contact details but start the guided flow at its first screen.
  const reset = await sb.from('business_onboarding').update({ state: {}, updated_at: new Date().toISOString() }).eq('business_id', business.id);
  if (reset.error && !['42P01', 'PGRST205'].includes(reset.error.code)) return NextResponse.json({ error: 'Could not reset onboarding. Please retry.' }, { status: 503 });

  const updated = await updateBusiness(business.id, decision.updates);

  return NextResponse.json({ ok: true, business: updated || business });
}
