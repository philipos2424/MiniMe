/**
 * POST /api/webhook/nango — receives webhooks FROM Nango.
 *
 * Two kinds:
 *   1. Auth webhooks (type 'auth'): a business just authorized a Meta channel.
 *      → store the connection ID, discover page/IG/phone assets via the proxy,
 *        subscribe the page to messages, notify the owner, and backfill history.
 *   2. Forwarded provider webhooks (type 'forward'): a Meta message event that
 *      Nango forwarded. → run it through the shared processMetaEvent pipeline.
 *
 * Configure this URL in the Nango dashboard (env → webhook settings).
 */
import { NextResponse } from 'next/server';
import { findById, update as updateBusiness } from '../../../../lib/server/businesses';
import { decrypt } from '../../../../lib/server/crypto';
import {
  verifyNangoWebhook,
  nangoProxy,
  platformForIntegration,
  NANGO_INTEGRATIONS,
} from '../../../../lib/server/nango';
import { processMetaEvent } from '../../../../lib/server/metaEvents';
import { rateLimit, getIP } from '../../../../lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  // Same budget as the direct Meta webhook (in-memory, per-instance — the
  // Upstash move is tracked in CLAUDE_HANDOFF High Priority #1).
  const { ok, retryAfter } = rateLimit(getIP(request), 'nango-webhook', 100, 60);
  if (!ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });

  let rawBody;
  try { rawBody = await request.text(); } catch { return NextResponse.json({ ok: true }); }

  if (!verifyNangoWebhook(request, rawBody)) {
    console.warn('[nango webhook] signature verification failed — rejecting');
    return NextResponse.json({ error: 'signature mismatch' }, { status: 401 });
  }

  let body;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: true }); }

  // A processing failure must surface as non-2xx so Nango redelivers.
  try {
    if (body.type === 'forward') {
      // Forwarded Meta event — payload should be the raw provider webhook
      // body. Guard the envelope shape: anything else is acked and ignored.
      if (body.payload?.object && Array.isArray(body.payload?.entry)) {
        await processMetaEvent(body.payload, { source: 'nango' });
      } else {
        console.warn('[nango webhook] unexpected forward payload shape — ignoring');
      }
    } else if (body.type === 'auth' || body.operation === 'creation') {
      await handleAuthWebhook(body);
    }
  } catch (e) {
    console.error('[nango webhook]', e.message);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * A new connection was authorized. Nango auth webhook fields include
 * providerConfigKey (integration ID), connectionId, and endUser.endUserId
 * (the business ID we tagged when creating the session).
 */
async function handleAuthWebhook(body) {
  const providerConfigKey = body.providerConfigKey || body.provider_config_key || body.provider;
  const connectionId = body.connectionId || body.connection_id;
  // Nango copies session `tags` onto the connection and echoes them here.
  const businessId = body.tags?.end_user_id || body.endUser?.endUserId;
  if (!connectionId || !businessId) return;

  // Only act on successful auths.
  if (body.success === false) return;

  // Prefer the platform tag we stamped on the session; fall back to mapping the
  // integration ID (in case a session allowed multiple platforms).
  // WhatsApp-via-Nango is deferred this phase (sessions only allow FB/IG —
  // see /api/nango/session), so only those two can arrive here.
  const taggedPlatform = ['facebook', 'instagram'].includes(body.tags?.platform)
    ? body.tags.platform : null;
  const platform = taggedPlatform || platformForIntegration(providerConfigKey);
  if (platform !== 'facebook' && platform !== 'instagram') {
    console.warn('[nango webhook] unsupported platform', providerConfigKey);
    return;
  }

  const business = await findById(businessId);
  if (!business) {
    console.warn('[nango webhook] business not found', businessId);
    return;
  }

  const connField = `nango_connection_id_${platform}`;
  const updates = { [connField]: connectionId };

  let pageName = null;
  let pageId = null;

  try {
    // Discover the page (and linked IG account) behind this connection.
    const res = await nangoProxy({
      method: 'GET',
      endpoint: '/me/accounts',
      integration: NANGO_INTEGRATIONS[platform],
      connectionId,
      params: { fields: 'id,name,instagram_business_account{id,username}' },
    });
    const page = (res?.data || [])[0];
    if (page) {
      pageName = page.name || null;
      if (platform === 'facebook') {
        pageId = page.id;
        updates.facebook_page_id = page.id;
      } else {
        pageId = page.instagram_business_account?.id || null;
        if (pageId) updates.instagram_page_id = pageId;
      }
      // Subscribe the page to message webhooks.
      if (page.id) {
        try {
          await nangoProxy({
            method: 'POST',
            endpoint: `/${page.id}/subscribed_apps`,
            integration: NANGO_INTEGRATIONS[platform],
            connectionId,
            params: { subscribed_fields: 'messages' },
          });
        } catch (e) {
          console.warn('[nango webhook] subscribe warning:', e.message);
        }
      }
    }
  } catch (e) {
    console.warn('[nango webhook] asset discovery failed:', e.message);
  }

  await updateBusiness(business.id, updates);
  console.log(`[nango webhook] connected ${platform} for business ${business.id}`);

  // Notify the owner on Telegram. History import is opt-in (it copies
  // customers' past messages into MiniMe, so the owner must ask for it) —
  // the button is handled by the metabf_ callback in replyEngine.
  try {
    const ownerChatId = business.owner_private_chat_id || business.owner_telegram_id;
    const botToken = business.telegram_bot_token_enc
      ? decrypt(business.telegram_bot_token_enc)
      : process.env.TELEGRAM_BOT_TOKEN;
    if (ownerChatId && botToken) {
      const label = platform === 'instagram' ? '📸 Instagram' : '👥 Facebook';
      const offerImport = !!pageId;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ownerChatId,
          text: `✅ *${label} connected!*${pageName ? `\n\nAccount: _${pageName}_` : ''}\n\nNew messages will now appear in MiniMe.${offerImport ? `\n\nWant me to import your recent DM history too? This stores those customers' past messages and names in MiniMe.` : ''}`,
          parse_mode: 'Markdown',
          ...(offerImport ? {
            reply_markup: {
              inline_keyboard: [[
                { text: '📥 Import recent history', callback_data: `metabf_yes_${platform}_${pageId}` },
                { text: 'Skip', callback_data: 'metabf_no' },
              ]],
            },
          } : {}),
        }),
      });
    }
  } catch (e) {
    console.warn('[nango webhook] owner notify failed:', e.message);
  }
}
