/**
 * GET /api/auth/tiktok/callback?code=xxx&state=xxx
 * TikTok OAuth callback — exchanges the code for tokens, resolves the Business
 * Account it belongs to, stores everything encrypted on the business row, then
 * redirects back to the channels settings page.
 *
 * The webhook subscription itself is configured once per *app* in the TikTok
 * developer portal (not per connected account), so there is nothing to
 * subscribe here the way the Meta callback subscribes a page.
 */
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { findById, update as updateBusiness } from '../../../../../lib/server/businesses';
import { decrypt } from '../../../../../lib/server/crypto';
import { exchangeCodeForTokens, storeTokens, getBusinessInfo } from '../../../../../lib/server/tiktokApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verify and decode the signed state token */
function verifyState(state) {
  if (!state) return null;
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  const [b64, sig] = state.split('.');
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac('sha256', key).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (payload.exp < Date.now()) return null; // expired
    return payload.bid; // businessId
  } catch { return null; }
}

function channelsUrl(host, params) {
  const url = new URL('/settings/channels', host);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const host = process.env.WEB_URL || `https://${request.headers.get('host')}`;

  if (error) return NextResponse.redirect(channelsUrl(host, { error: 'oauth_denied' }));
  if (!code || !state) return NextResponse.redirect(channelsUrl(host, { error: 'missing_params' }));

  const businessId = verifyState(state);
  if (!businessId) return NextResponse.redirect(channelsUrl(host, { error: 'invalid_state' }));

  const business = await findById(businessId);
  if (!business) return NextResponse.redirect(channelsUrl(host, { error: 'business_not_found' }));

  const redirectUri = `${host}/api/auth/tiktok/callback`;

  try {
    const data = await exchangeCodeForTokens(code, redirectUri);

    // The account identifier TikTok returns varies by product; take the first
    // one present. This is the value inbound webhooks are matched against, so
    // without it the connection cannot receive anything.
    const tiktokBusinessId = data?.business_id || data?.bc_id || data?.open_id || null;
    if (!tiktokBusinessId) {
      console.error('[tiktok callback] no business/open id in token response');
      return NextResponse.redirect(channelsUrl(host, { error: 'no_business_id' }));
    }

    await storeTokens(business.id, data, {
      tiktok_business_id: String(tiktokBusinessId),
      tiktok_connected_at: new Date().toISOString(),
    });

    // Best-effort: fetch the handle so the settings page can show which
    // account is connected. A failure here must not fail the connection.
    try {
      const token = data?.access_token || data?.token;
      if (token) {
        const info = await getBusinessInfo({ token, businessId: String(tiktokBusinessId) });
        const username = info?.username || info?.display_name || null;
        if (username) {
          await updateBusiness(business.id, {
            tiktok_username: info?.username || null,
            tiktok_display_name: info?.display_name || null,
          });
        }
      }
    } catch (e) {
      console.warn('[tiktok callback] profile lookup failed:', e.message);
    }

    // Tell the owner on Telegram, same as the Meta/Nango connection flow does.
    try {
      const ownerChatId = business.owner_private_chat_id || business.owner_telegram_id;
      const botToken = business.telegram_bot_token_enc
        ? decrypt(business.telegram_bot_token_enc)
        : process.env.TELEGRAM_BOT_TOKEN;
      if (ownerChatId && botToken) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: ownerChatId,
            text: '✅ *🎵 TikTok connected!*\n\nNew TikTok DMs will now appear in MiniMe.\n\nNote: on TikTok the customer has to message you first — you cannot start a chat.',
            parse_mode: 'Markdown',
          }),
        });
      }
    } catch (e) {
      console.warn('[tiktok callback] owner notify failed:', e.message);
    }

    return NextResponse.redirect(channelsUrl(host, { connected: 'tiktok' }));
  } catch (e) {
    console.error('[tiktok callback]', e.message);
    return NextResponse.redirect(channelsUrl(host, { error: 'token_exchange_failed' }));
  }
}
