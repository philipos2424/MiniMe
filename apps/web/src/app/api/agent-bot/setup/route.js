/**
 * GET /api/agent-bot/setup
 *
 * Registers (or re-registers) the main MiniMe bot webhook with Telegram.
 * Also enables business_message and business_connection update types.
 *
 * Call once after deploying or if messages stop coming through.
 * Protected by CRON_SECRET.
 *
 * Usage: GET https://web-theta-one-68.vercel.app/api/agent-bot/setup
 *        Authorization: Bearer <CRON_SECRET>
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token   = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const secret  = (process.env.AGENT_BOT_WEBHOOK_SECRET || '').trim();
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim();

  if (!token) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 });

  const webhookUrl = `${baseUrl}/api/agent-bot/webhook`;

  const body = {
    url: webhookUrl,
    allowed_updates: [
      'message',
      'edited_message',
      'callback_query',
      'business_connection',
      'business_message',
      'edited_business_message',
    ],
    max_connections: 40,
    drop_pending_updates: false,
  };
  if (secret) body.secret_token = secret;

  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await r.json();

  // Also get current webhook info
  const infoR = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = await infoR.json();

  return NextResponse.json({
    set_webhook: result,
    webhook_info: info.result,
    registered_url: webhookUrl,
  });
}
