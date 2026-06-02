/**
 * GET /api/admin/reregister-webhooks
 *
 * Bulk re-registers Telegram webhooks for ALL businesses that have a bot linked.
 * Fixes bots that stopped responding after a URL change.
 *
 * Protected by CRON_SECRET.
 * Usage: GET /api/admin/reregister-webhooks
 *        Authorization: Bearer <CRON_SECRET>
 *
 * Returns a summary of ok/failed re-registrations.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '../../../../lib/server/crypto';
import { allowedUpdates, isPlatformBotToken } from '../../../../lib/server/telegramConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const baseUrl = (process.env.WEB_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // Fetch all businesses with a bot token
  const { data: businesses, error } = await sb
    .from('businesses')
    .select('id, name, telegram_bot_username, telegram_bot_token_enc, webhook_secret')
    .not('telegram_bot_token_enc', 'is', null)
    .not('webhook_secret', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];
  let ok = 0;
  let failed = 0;

  let skipped = 0;
  for (const biz of businesses || []) {
    try {
      const token = decrypt(biz.telegram_bot_token_enc);

      // CRITICAL: never re-point a MiniMe system bot (shared @MiniMeAgentBot /
      // search bot) to a per-tenant webhook path. Doing so silences Secretary
      // Mode + shared mode for everyone. If a business row mistakenly stored a
      // platform token, skip it entirely (and flag it for cleanup).
      if (isPlatformBotToken(token)) {
        skipped++;
        results.push({ id: biz.id, name: biz.name, bot: biz.telegram_bot_username, status: 'skipped_platform_bot' });
        continue;
      }

      const webhookUrl = `${baseUrl}/api/telegram/webhook/${biz.webhook_secret}`;

      const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: biz.webhook_secret,
          allowed_updates: allowedUpdates(),
        }),
        signal: AbortSignal.timeout(8000),
      });

      const j = await r.json();

      if (j.ok) {
        ok++;
        results.push({ id: biz.id, name: biz.name, bot: biz.telegram_bot_username, status: 'ok', url: webhookUrl });
      } else {
        failed++;
        results.push({ id: biz.id, name: biz.name, bot: biz.telegram_bot_username, status: 'failed', error: j.description });
      }
    } catch (e) {
      failed++;
      results.push({ id: biz.id, name: biz.name, bot: biz.telegram_bot_username, status: 'error', error: e.message });
    }

    // Small delay to avoid hitting Telegram rate limits
    await new Promise(r => setTimeout(r, 50));
  }

  return NextResponse.json({
    total: businesses?.length || 0,
    ok,
    failed,
    skipped,
    base_url: baseUrl,
    results,
  });
}
