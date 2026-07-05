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
import crypto from 'node:crypto';
import { findByWebhookSecret } from '../../../../../lib/server/businesses';
import { decrypt } from '../../../../../lib/server/crypto';
import { handleTenantUpdate } from '../../../../../lib/server/replyEngine';
import { handleChannelPost, handleChannelMembership } from '../../../../../lib/server/channelIngest';
import { rateLimit, getIP } from '../../../../../lib/server/rateLimit';
import { ensureSharedWebhook } from '../../../../../lib/server/sharedWebhookGuard';
import { logWebhookEvent } from '../../../../../lib/server/webhookHealth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request, { params }) {
  try {
    // Rate limit: max 120 updates/min per IP (Telegram's own limit is ~30/s per bot)
    const ip = getIP(request);
    const { ok, retryAfter } = rateLimit(ip, 'tg-webhook', 120, 60);
    if (!ok) {
      return NextResponse.json({ error: 'too_many_requests' }, {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      });
    }

    const { secret } = params;
    if (!secret || secret.length < 16) {
      return NextResponse.json({ error: 'bad_secret' }, { status: 400 });
    }

    // Verify Telegram's secret_token header matches our path secret.
    // Use timingSafeEqual to prevent timing attacks that could leak the secret.
    const headerSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
    const a = Buffer.from(headerSecret);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('Webhook secret header mismatch');
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const update = await request.json();

    // Canary self-heal: custom-bot traffic keeps flowing even if the SHARED
    // @MiniMeAgentBot webhook is broken (wrong URL / missing business_*). Use
    // this live traffic to verify + repair the shared bot so Secretary Mode and
    // shared mode recover within minutes — without waiting for the daily cron.
    // Throttled to ~once/15min per warm instance; never throws.
    await ensureSharedWebhook();

    // ── Bot sender guard — never reply to another bot (loop prevention) ──
    // Notification bots and other automated senders set from.is_bot. Replying
    // to them creates endless bot-to-bot loops. Callback queries are always
    // from real users tapping buttons, so they're exempt.
    const senderFrom = update.message?.from
      || update.edited_message?.from
      || update.business_message?.from
      || update.edited_business_message?.from;
    if (senderFrom?.is_bot) {
      console.log(`[tenant-webhook] message from bot (${senderFrom?.username || senderFrom?.id}) — ignoring`);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

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
      logWebhookEvent({ business_id: business.id, delivery_status: 'failure', error_message: `decrypt: ${e.message}` });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const _dispatchStart = Date.now();

    // ── Send typing indicator IMMEDIATELY — customer sees "..." within ~200ms ──
    // This makes even 3-4s responses FEEL fast. Fire-and-forget — never block on it.
    const customerChatId = update.message?.chat?.id
      || update.callback_query?.message?.chat?.id
      || update.business_message?.chat?.id;
    const incomingText = update.message?.text || update.business_message?.text;
    const businessConnId = update.business_message?.business_connection_id;

    if (customerChatId && incomingText && !incomingText.startsWith('/')) {
      const chatActionBody = { chat_id: customerChatId, action: 'typing' };
      if (businessConnId) chatActionBody.business_connection_id = businessConnId;
      fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatActionBody),
      }).catch(() => {});
    }

    // ── Idempotency: dedupe by update_id ─────────────────────────────────────
    // Telegram retries failed webhooks. Without dedup we'd process the same
    // message twice (duplicate replies, duplicate orders). We insert a marker
    // into webhook_dedupe; if it conflicts, we've already processed this.
    if (typeof update.update_id === 'number') {
      try {
        const { supabase } = await import('../../../../../lib/server/db');
        const { error } = await supabase().from('webhook_dedupe').insert({
          business_id: business.id,
          update_id: update.update_id,
        });
        // PG unique-violation code = 23505 → already processed, skip
        if (error && error.code === '23505') {
          console.log('Skipping duplicate update', update.update_id);
          return NextResponse.json({ ok: true, deduped: true }, { status: 200 });
        }
      } catch (e) {
        // Table may not exist yet — proceed anyway (fail-open for availability)
        console.warn('dedup check failed (table may be missing):', e.message);
      }
    }

    // ── Channel monitoring — the bot is an admin of the owner's channel ──────
    // my_chat_member links/unlinks the channel; channel_post ingests products.
    // Business is already resolved from the webhook secret, so we pass it in.
    try {
      if (update.my_chat_member) {
        if (await handleChannelMembership({ update, business, token })) {
          logWebhookEvent({ business_id: business.id, delivery_status: 'success', response_time_ms: Date.now() - _dispatchStart });
          return NextResponse.json({ ok: true }, { status: 200 });
        }
      }
      if (update.channel_post || update.edited_channel_post) {
        await handleChannelPost({ update, business, token });
        logWebhookEvent({ business_id: business.id, delivery_status: 'success', response_time_ms: Date.now() - _dispatchStart });
        return NextResponse.json({ ok: true }, { status: 200 });
      }
    } catch (err) {
      console.error('[tenant-webhook] channel ingest error:', err);
      logWebhookEvent({ business_id: business.id, delivery_status: 'failure', response_time_ms: Date.now() - _dispatchStart, error_message: err.message });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // IMPORTANT: Vercel serverless functions terminate the moment the response
    // returns — we must AWAIT the handler, not fire-and-forget. Telegram gives
    // us up to 60s before it considers the webhook timed out.
    try {
      await handleTenantUpdate(business, token, update);
      logWebhookEvent({ business_id: business.id, delivery_status: 'success', response_time_ms: Date.now() - _dispatchStart });
    } catch (err) {
      console.error('handleTenantUpdate error:', err);
      logWebhookEvent({ business_id: business.id, delivery_status: 'failure', response_time_ms: Date.now() - _dispatchStart, error_message: err.message });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error('webhook error:', e);
    // Always 200 so Telegram doesn't retry-storm us
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
