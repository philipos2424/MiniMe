/**
 * POST /api/bot/refresh-webhook
 * Re-registers the Telegram webhook so the bot subscribes to pre_checkout_query
 * (added when Stars payments shipped). Idempotent.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business?.telegram_bot_token_enc || !business.webhook_secret) {
    return NextResponse.json({ error: 'no_bot_linked' }, { status: 400 });
  }

  let token;
  try { token = decrypt(business.telegram_bot_token_enc); }
  catch { return NextResponse.json({ error: 'decrypt_failed' }, { status: 500 }); }

  const baseUrl = (process.env.WEB_URL || `https://${request.headers.get('host')}`).replace(/\/$/, '');
  const webhookUrl = `${baseUrl}/api/telegram/webhook/${business.webhook_secret}`;

  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: business.webhook_secret,
      allowed_updates: ['message', 'edited_message', 'callback_query', 'pre_checkout_query'],
    }),
  });
  const j = await r.json();
  if (!j.ok) return NextResponse.json({ error: j.description || 'setWebhook failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
