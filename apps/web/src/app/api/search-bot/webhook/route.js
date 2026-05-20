/**
 * POST /api/search-bot/webhook
 *
 * Webhook for @MiniMeSearchBot — the single public search bot.
 * Unlike the multi-tenant webhook, this has a fixed secret stored in env vars.
 *
 * Required env vars:
 *   SEARCH_BOT_TOKEN          — the bot token for @MiniMeSearchBot
 *   SEARCH_BOT_WEBHOOK_SECRET — matches the secret_token set with Telegram's setWebhook
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { handleSearchBotUpdate, handleSearchBotCallback } from '../../../../lib/server/searchBot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const token  = process.env.SEARCH_BOT_TOKEN;
    const secret = process.env.SEARCH_BOT_WEBHOOK_SECRET;

    if (!token || !secret) {
      console.warn('[search-bot] SEARCH_BOT_TOKEN or SEARCH_BOT_WEBHOOK_SECRET not set');
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Verify Telegram's secret_token header
    const headerSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
    const a = Buffer.from(headerSecret);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('[search-bot] webhook secret mismatch');
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const update = await request.json();

    try {
      if (update.callback_query) {
        await handleSearchBotCallback(token, update.callback_query);
      } else {
        await handleSearchBotUpdate(token, update);
      }
    } catch (e) {
      console.error('[search-bot] handler error:', e);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error('[search-bot] webhook error:', e);
    return NextResponse.json({ ok: true }, { status: 200 }); // always 200 so Telegram doesn't retry
  }
}
