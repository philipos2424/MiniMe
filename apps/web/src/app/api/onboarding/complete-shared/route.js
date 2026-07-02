/**
 * POST /api/onboarding/complete-shared
 *
 * Completes onboarding for shared-mode businesses (no BotFather bot).
 * Sets bot_mode = 'shared', onboarding_completed = true.
 * Returns the business with its shop_code for the deep link.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, update as updateBusiness, generateShopCode } from '../../../../lib/server/businesses';
import { awardReferral } from '../../../../lib/server/referrals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRIAL_DAYS = 14;

export async function POST(request) {
  try {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const business = await findByOwnerTelegramId(tg.id);
  if (!business) {
    return NextResponse.json({ error: 'no_business', detail: 'Create a business first via /api/onboarding/business' }, { status: 400 });
  }

  const updates = {
    onboarding_completed: true,
    bot_mode: 'shared',
    brain_mode: true,
    trust_level: 2,
  };
  // Ensure shop_code exists
  if (!business.shop_code) updates.shop_code = generateShopCode();

  // Start the free trial on activation.
  // We start the clock when the owner actually goes live (not at signup) so
  // they get the full trial period of REAL product time. Idempotent: if a trial is
  // already running (re-activation, retry), don't reset the clock.
  if (!business.trial_started_at) {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    updates.trial_started_at = now.toISOString();
    updates.trial_ends_at = trialEnd.toISOString();
    updates.subscription_status = 'trial';
  }

  const updated = await updateBusiness(business.id, updates);
  // Tell the truth: a null here is a REAL update failure (the optional-column
  // strip/retry already happened inside update()). Faking ok:true left owners
  // "activated" client-side with a business row that never flipped live.
  if (!updated) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // First activation of a referred business → credit both sides (idempotent,
  // fire-and-forget — rewards must never block going live).
  awardReferral({ ...business, ...updated }, process.env.TELEGRAM_BOT_TOKEN).catch(() => {});

  // Notify platform admin
  const adminId = process.env.PLATFORM_ADMIN_TELEGRAM_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (adminId && botToken) {
    const ownerName = business.owner_name || tg.first_name || 'Unknown';
    const tgHandle = tg.username ? ` (@${tg.username})` : '';
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminId,
        parse_mode: 'Markdown',
        text: `✅ *Shared-mode signup complete!*\n\n🏪 *${business.name}*\n👤 ${ownerName}${tgHandle}\n🔗 shop\\_${updated?.shop_code || business.shop_code}\n📂 ${business.category || 'uncategorised'}\n\n_Using @MiniMeAgentBot — no custom bot._`,
      }),
      signal: AbortSignal.timeout(6000),
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    business: updated,
    shop_code: updated.shop_code || business.shop_code,
  });
  } catch (e) {
    console.error('[complete-shared] failed:', e);
    return NextResponse.json({ error: 'server_error', detail: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
