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
import { isCronAuthorized } from '../../../../lib/server/auth';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { audit } from '../../../../lib/server/audit';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '../../../../lib/server/crypto';
import { allowedUpdates, isPlatformBotToken } from '../../../../lib/server/telegramConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function gateAdmin(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

async function reregisterWebhooks({ businessIds = null, request = null }) {
  const baseUrl = (process.env.WEB_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } },
  );

  // Fetch all businesses with a bot token
  let query = sb
    .from('businesses')
    .select('id, name, telegram_bot_username, telegram_bot_token_enc, webhook_secret')
    .not('telegram_bot_token_enc', 'is', null)
    .not('webhook_secret', 'is', null);
  if (Array.isArray(businessIds) && businessIds.length) {
    query = query.in('id', businessIds);
  }
  const { data: businesses, error } = await query;

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

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return reregisterWebhooks({ request });
}

export async function POST(request) {
  const admin = await gateAdmin(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const businessIds = Array.isArray(body.business_ids)
    ? body.business_ids.map(String).filter(Boolean).slice(0, 200)
    : null;
  const response = await reregisterWebhooks({ businessIds, request });
  const payload = await response.json();
  await audit({
    business_id: null,
    actor_type: 'platform_admin',
    actor_id: admin.id,
    action: 'admin.webhooks_reregistered',
    resource_type: 'telegram_webhook',
    metadata: {
      requested_business_ids: businessIds,
      total: payload.total,
      ok: payload.ok,
      failed: payload.failed,
      skipped: payload.skipped,
    },
    request,
  });
  return NextResponse.json(payload, { status: response.status });
}
