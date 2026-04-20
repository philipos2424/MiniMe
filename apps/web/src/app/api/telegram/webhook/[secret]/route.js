/**
 * Multi-tenant Telegram webhook.
 *
 * Telegram POSTs each update to /api/telegram/webhook/<secret>.
 * We look up the tenant by their unique `webhook_secret`, decrypt their bot
 * token, instantiate a TelegramBot, and dispatch the update through the
 * existing handler stack in apps/bot/src.
 *
 * Verifies the X-Telegram-Bot-Api-Secret-Token header matches the path
 * secret — this blocks random internet traffic from reaching handlers.
 */
import { NextResponse } from 'next/server';
import { findByWebhookSecret } from '../../../../../lib/server/businesses';
import { decrypt } from '../../../../../lib/server/crypto';
import { handleTenantUpdate } from '../../../../../lib/server/replyEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request, { params }) {
  try {
    const { secret } = params;
    if (!secret || secret.length < 16) {
      return NextResponse.json({ error: 'bad_secret' }, { status: 400 });
    }

    // Verify Telegram's secret_token header matches our path secret
    const headerSecret = request.headers.get('x-telegram-bot-api-secret-token');
    if (headerSecret !== secret) {
      console.warn('Webhook secret header mismatch');
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const update = await request.json();

    // Look up tenant
    const business = await findByWebhookSecret(secret);
    if (!business || !business.telegram_bot_token_enc) {
      console.warn('No business found for webhook secret');
      return NextResponse.json({ ok: true }, { status: 200 }); // 200 so Telegram doesn't retry
    }

    // Decrypt token
    let token;
    try {
      token = decrypt(business.telegram_bot_token_enc);
    } catch (e) {
      console.error('Token decrypt failed for business', business.id, e.message);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // IMPORTANT: Vercel serverless functions terminate the moment the response
    // returns — we must AWAIT the handler, not fire-and-forget. Telegram gives
    // us up to 60s before it considers the webhook timed out.
    try {
      await handleTenantUpdate(business, token, update);
    } catch (err) {
      console.error('handleTenantUpdate error:', err);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error('webhook error:', e);
    // Always 200 so Telegram doesn't retry-storm us
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
