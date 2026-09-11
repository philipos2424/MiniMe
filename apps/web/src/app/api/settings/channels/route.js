/**
 * GET    /api/settings/channels — connection state for every non-Telegram channel
 * POST   /api/settings/channels — connect one platform { platform, id, access_token? }
 * DELETE /api/settings/channels?platform=whatsapp — disconnect a platform
 *
 * The three Meta platforms share one access token (Meta System User token), so
 * that token is stored once at the business level and reused across
 * whatsapp/ig/fb.
 *
 * TikTok is different in kind: it has no manual ID/token entry at all. A
 * business connects it by OAuth (/api/auth/tiktok), which writes the account
 * ID and encrypted tokens itself — so here TikTok is read-only apart from
 * `test` and disconnect.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { encrypt, decrypt } from '../../../../lib/server/crypto';
import { deleteConnection, NANGO_INTEGRATIONS, nangoConfigured } from '../../../../lib/server/nango';
import { tiktokConfigured, getAccessToken, listConversations } from '../../../../lib/server/tiktokApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return null;
  const business = await findBusinessForUser(tg.id);
  return business || null;
}

function maskLast4(str) {
  if (!str) return null;
  return str.length > 4 ? '••••' + str.slice(-4) : '••••';
}

export async function GET(request) {
  const business = await gate(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const webhookBase = (process.env.WEB_URL || `https://${request.headers.get('host')}`).replace(/\/$/, '');

  return NextResponse.json({
    webhook_url: `${webhookBase}/api/webhook/meta`,
    verify_token_hint: process.env.META_VERIFY_TOKEN ? maskLast4(process.env.META_VERIFY_TOKEN) : null,
    has_access_token: !!business.meta_access_token_enc,
    // When Nango is configured, the UI should offer one-tap Connect instead of
    // manual ID/token entry.
    nango_enabled: nangoConfigured(),
    whatsapp: {
      connected: !!business.whatsapp_phone_number_id,
      phone_number_id: business.whatsapp_phone_number_id || null,
      masked: maskLast4(business.whatsapp_phone_number_id),
      via_nango: !!business.nango_connection_id_whatsapp,
    },
    instagram: {
      connected: !!business.instagram_page_id,
      page_id: business.instagram_page_id || null,
      masked: maskLast4(business.instagram_page_id),
      via_nango: !!business.nango_connection_id_instagram,
    },
    facebook: {
      connected: !!business.facebook_page_id,
      page_id: business.facebook_page_id || null,
      masked: maskLast4(business.facebook_page_id),
      via_nango: !!business.nango_connection_id_facebook,
    },
    tiktok: {
      connected: !!business.tiktok_business_id,
      // OAuth-only: the UI shows a Connect button, never an ID/token form.
      oauth_ready: tiktokConfigured(),
      username: business.tiktok_username || null,
      display_name: business.tiktok_display_name || null,
      masked: maskLast4(business.tiktok_business_id),
      connected_at: business.tiktok_connected_at || null,
      // The webhook URL is per-app, not per-business, and only meaningful to
      // whoever configures the TikTok app — so only hand back the shape when
      // the path secret is set, never the secret itself.
      webhook_url: process.env.TIKTOK_WEBHOOK_PATH_SECRET
        ? `${webhookBase}/api/webhook/tiktok/••••`
        : null,
    },
  });
}

export async function POST(request) {
  const business = await gate(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { platform, id, access_token, action } = body;

  const sb = supabase();

  // TikTok connection test — proves the stored token still works by asking for
  // the account's conversation list. Nothing is sent to any customer.
  if (action === 'test' && platform === 'tiktok') {
    if (!business.tiktok_business_id) return NextResponse.json({ ok: false, error: 'TikTok is not connected' });
    try {
      const token = await getAccessToken(business);
      if (!token) return NextResponse.json({ ok: false, error: 'No usable TikTok token — reconnect' });
      const data = await listConversations({ token, businessId: business.tiktok_business_id, pageSize: 1 });
      return NextResponse.json({
        ok: true,
        account: { username: business.tiktok_username, id: business.tiktok_business_id },
        has_conversations: Array.isArray(data?.conversations || data?.list) ? true : undefined,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e.message });
    }
  }

  // Test connection action — calls Meta Graph API /me with stored or provided token
  if (action === 'test') {
    const tokenToTest = access_token || (business.meta_access_token_enc ? decrypt(business.meta_access_token_enc) : null);
    if (!tokenToTest) return NextResponse.json({ ok: false, error: 'No access token to test' });
    try {
      const r = await fetch('https://graph.facebook.com/v21.0/me?fields=id,name', {
        headers: { Authorization: `Bearer ${tokenToTest}` },
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (!r.ok) return NextResponse.json({ ok: false, error: j.error?.message || 'Meta API error' });
      return NextResponse.json({ ok: true, account: j });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e.message });
    }
  }

  if (platform === 'tiktok') {
    // TikTok has no manual path — an account is connected only by OAuth, which
    // is the one flow that can produce a token we are able to refresh.
    return NextResponse.json({ error: 'Connect TikTok via /api/auth/tiktok' }, { status: 400 });
  }

  if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  const updates = {};

  // ID field name per platform
  const idField = platform === 'whatsapp' ? 'whatsapp_phone_number_id'
    : platform === 'instagram' ? 'instagram_page_id'
    : 'facebook_page_id';

  if (typeof id === 'string') {
    const trimmed = id.trim();
    if (!trimmed) return NextResponse.json({ error: 'ID required' }, { status: 400 });
    if (trimmed.length > 64) return NextResponse.json({ error: 'ID too long' }, { status: 400 });
    updates[idField] = trimmed;
  }

  // Access token (shared across all platforms)
  if (typeof access_token === 'string' && access_token.trim()) {
    try {
      updates.meta_access_token_enc = encrypt(access_token.trim());
    } catch (e) {
      return NextResponse.json({ error: 'Could not encrypt token: ' + e.message }, { status: 500 });
    }
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { error } = await sb.from('businesses').update(updates).eq('id', business.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const business = await gate(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const platform = new URL(request.url).searchParams.get('platform');

  if (platform === 'tiktok') {
    // Drop the account link and both tokens. Existing TikTok conversations stay
    // in the inbox as history; they just stop receiving and sending.
    const { error } = await supabase().from('businesses').update({
      tiktok_business_id: null,
      tiktok_username: null,
      tiktok_display_name: null,
      tiktok_access_token_enc: null,
      tiktok_refresh_token_enc: null,
      tiktok_token_expires_at: null,
      tiktok_connected_at: null,
    }).eq('id', business.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  const idField = platform === 'whatsapp' ? 'whatsapp_phone_number_id'
    : platform === 'instagram' ? 'instagram_page_id'
    : 'facebook_page_id';
  const connField = `nango_connection_id_${platform}`;

  const sb = supabase();
  const updates = { [idField]: null, [connField]: null };

  // Best-effort: revoke the connection in Nango so tokens are cleaned up too.
  const connId = business[connField];
  if (connId) {
    try {
      await deleteConnection({ integration: NANGO_INTEGRATIONS[platform], connectionId: connId });
    } catch (e) {
      console.warn('[channels] Nango disconnect failed:', e.message);
    }
  }

  // If this was the last connected platform, also clear the legacy token
  const otherFields = ['whatsapp_phone_number_id', 'instagram_page_id', 'facebook_page_id'].filter(f => f !== idField);
  const stillConnected = otherFields.some(f => !!business[f]);
  if (!stillConnected) updates.meta_access_token_enc = null;

  const { error } = await sb.from('businesses').update(updates).eq('id', business.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, token_cleared: !stillConnected });
}
