/**
 * GET /api/debug/bot-check
 *
 * Diagnoses common bot connectivity issues for a business:
 *   1. Token decryption — can we read the stored bot token?
 *   2. Telegram getMe — does the token actually work?
 *   3. Webhook info — is the webhook registered to the right URL?
 *
 * Auth: same Telegram initData as the dashboard (owner only).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { decrypt } from '../../../../lib/server/crypto';
import { requireOwner } from '../../../../lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'no_business' }, { status: 404 });
  if (!requireOwner(business, tg)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const result = {
    business_id: business.id,
    business_name: business.name,
    checks: {},
  };

  // 1. Token encryption check
  if (!business.telegram_bot_token_enc) {
    result.checks.token = { ok: false, error: 'No encrypted token stored — bot not connected via onboarding' };
    return NextResponse.json(result);
  }
  result.checks.token_enc_exists = { ok: true };

  let token;
  try {
    token = decrypt(business.telegram_bot_token_enc);
    result.checks.token_decrypt = { ok: !!token };
  } catch (e) {
    result.checks.token_decrypt = { ok: false, error: e.message };
    return NextResponse.json(result);
  }

  // 2. Telegram getMe — verify token with Telegram API
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(5000),
    });
    const me = await meRes.json();
    result.checks.telegram_getme = {
      ok: me.ok,
      bot_username: me.result?.username,
      bot_name: me.result?.first_name,
      error: me.ok ? undefined : me.description,
    };
  } catch (e) {
    result.checks.telegram_getme = { ok: false, error: e.message };
  }

  // 3. Webhook info — what URL is Telegram sending updates to?
  try {
    const whRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
      signal: AbortSignal.timeout(5000),
    });
    const wh = await whRes.json();
    const webhookInfo = wh.result || {};
    const expectedPath = '/api/telegram/webhook/';
    result.checks.webhook = {
      ok: wh.ok && !!webhookInfo.url,
      url_configured: !!webhookInfo.url,
      has_correct_path: webhookInfo.url?.includes(expectedPath),
      pending_update_count: webhookInfo.pending_update_count,
      last_error_message: webhookInfo.last_error_message || null,
      last_error_date: webhookInfo.last_error_date
        ? new Date(webhookInfo.last_error_date * 1000).toISOString()
        : null,
    };
  } catch (e) {
    result.checks.webhook = { ok: false, error: e.message };
  }

  // Summary
  const allOk = Object.values(result.checks).every(c => c.ok !== false);
  result.summary = allOk ? '✅ Everything looks good' : '⚠️ Issues found — see checks above';

  return NextResponse.json(result);
}
