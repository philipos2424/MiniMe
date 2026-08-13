/**
 * POST /api/search-bot/register
 *
 * One-time setup: registers the search bot webhook with Telegram.
 * Call this once after deploying or when the token/URL changes.
 * Protected by CRON_SECRET (same header used by crons).
 *
 * curl -X POST https://your-domain/api/search-bot/register \
 *   -H "Authorization: Bearer $CRON_SECRET"
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { tg } from '../../../../lib/server/telegramApi';
import { SEARCH_BOT_PROFILE, applyBotProfile } from '../../../../lib/server/botProfileCopy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const auth = request.headers.get('authorization') || '';
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token  = process.env.SEARCH_BOT_TOKEN;
  const secret = process.env.SEARCH_BOT_WEBHOOK_SECRET;
  const baseUrl = (process.env.WEB_URL || `https://${request.headers.get('host')}`).replace(/\/$/, '');

  if (!token || !secret) {
    return NextResponse.json({ error: 'SEARCH_BOT_TOKEN or SEARCH_BOT_WEBHOOK_SECRET not set' }, { status: 500 });
  }

  const webhookUrl = `${baseUrl}/api/search-bot/webhook`;

  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query', 'inline_query'],
      drop_pending_updates: false,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();

  if (!j.ok) {
    return NextResponse.json({ error: j.description || 'setWebhook failed' }, { status: 500 });
  }

  // Set search bot commands (default + Amharic variant)
  await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'start',    description: 'Welcome — learn how to search' },
        { command: 'help',     description: 'How to use MiniMe Search' },
        { command: 'feedback', description: 'Leave feedback about MiniMe Search' },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
  await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'start',    description: 'እንኳን በደህና መጡ — እንዴት መፈለግ እንደሚቻል' },
        { command: 'help',     description: 'MiniMe Search እንዴት ጥቅም ላይ ይውላል' },
        { command: 'feedback', description: 'ስለ MiniMe Search አስተያየት ይስጡ' },
      ],
      language_code: 'am',
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});

  let profile_result = 'ok';
  try {
    await applyBotProfile(tg, token, SEARCH_BOT_PROFILE, ['am']);
  } catch (e) { profile_result = e.message; }

  return NextResponse.json({ ok: true, webhook_url: webhookUrl, profile_result });
}
