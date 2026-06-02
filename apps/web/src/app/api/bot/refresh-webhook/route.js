/**
 * POST /api/bot/refresh-webhook
 * Re-registers the Telegram webhook so the bot subscribes to pre_checkout_query
 * (added when Stars payments shipped). Idempotent.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { decrypt } from '../../../../lib/server/crypto';
import { allowedUpdates, isPlatformBotToken } from '../../../../lib/server/telegramConfig';

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

  // Defensive: never re-point a MiniMe system bot to a per-tenant path.
  if (isPlatformBotToken(token)) {
    return NextResponse.json({ error: 'platform_token_not_allowed' }, { status: 400 });
  }

  const baseUrl = (process.env.WEB_URL || `https://${request.headers.get('host')}`).replace(/\/$/, '');
  const webhookUrl = `${baseUrl}/api/telegram/webhook/${business.webhook_secret}`;

  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: business.webhook_secret,
      allowed_updates: allowedUpdates(),
    }),
  });
  const j = await r.json();
  if (!j.ok) return NextResponse.json({ error: j.description || 'setWebhook failed' }, { status: 500 });

  // Re-register command list (fire-and-forget)
  fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'orders',    description: 'Pending orders & active jobs' },
        { command: 'sales',     description: 'Revenue summary (today / week / month)' },
        { command: 'stock',     description: 'Inventory levels & low-stock alerts' },
        { command: 'price',     description: 'Update a product price — /price Injera 18' },
        { command: 'restock',   description: 'Update stock — /restock Injera +50 or 100' },
        { command: 'customers', description: 'List your customers' },
        { command: 'dm',        description: 'DM a customer — /dm Sara your order is ready' },
        { command: 'advisor',   description: 'Ask the AI advisor anything' },
        { command: 'teach',     description: 'Teach MiniMe about your business' },
        { command: 'rule',      description: 'Add a behavior rule — /rule use emojis' },
        { command: 'rules',     description: 'List all behavior rules' },
        { command: 'knowledge', description: 'View & delete knowledge items' },
        { command: 'forget',    description: 'Delete a knowledge item by title' },
        { command: 'reminders', description: 'View pending reminders' },
      ],
      scope: { type: 'all_private_chats' },
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
