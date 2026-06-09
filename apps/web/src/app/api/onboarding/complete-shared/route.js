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

  const updated = await updateBusiness(business.id, updates);

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
    business: updated || business,
    shop_code: updated?.shop_code || business.shop_code,
  });
}
