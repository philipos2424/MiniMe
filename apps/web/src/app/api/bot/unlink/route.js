/**
 * POST /api/bot/unlink — removes webhook + clears stored token.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, update as updateBusiness } from '../../../../lib/server/businesses';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const initData = request.headers.get('x-telegram-init-data');
    if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const tgUser = parseTelegramUser(initData);
    if (!tgUser?.id) return NextResponse.json({ error: 'bad_init_data' }, { status: 401 });

    const business = await findByOwnerTelegramId(tgUser.id);
    if (!business || !business.telegram_bot_token_enc) {
      return NextResponse.json({ ok: true, already_unlinked: true });
    }

    try {
      const token = decrypt(business.telegram_bot_token_enc);
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drop_pending_updates: true }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      console.warn('deleteWebhook failed (continuing):', e.message);
    }

    await updateBusiness(business.id, {
      telegram_bot_token_enc: null,
      telegram_bot_username: null,
      telegram_bot_id: null,
      webhook_secret: null,
      bot_linked_at: null,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('/api/bot/unlink error:', e);
    return NextResponse.json({ error: 'internal', detail: e.message }, { status: 500 });
  }
}
