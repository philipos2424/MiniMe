/**
 * GET /api/auth/meta/callback?code=xxx&state=xxx
 * Facebook OAuth callback — exchanges code for token, discovers pages/IG,
 * stores encrypted token + IDs, subscribes page to webhooks, then redirects
 * back to the channels settings page.
 */
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { encrypt } from '../../../../../lib/server/crypto';
import { findById, update as updateBusiness } from '../../../../../lib/server/businesses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const META_APP_ID     = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const GRAPH           = 'https://graph.facebook.com/v21.0';

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

  // User denied permission
  if (error) {
    return NextResponse.redirect(channelsUrl(host, { error: 'oauth_denied' }));
  }

  if (!code || !state) {
    return NextResponse.redirect(channelsUrl(host, { error: 'missing_params' }));
  }

  // 1. Verify state → get businessId
  const businessId = verifyState(state);
  if (!businessId) {
    return NextResponse.redirect(channelsUrl(host, { error: 'invalid_state' }));
  }

  const business = await findById(businessId);
  if (!business) {
    return NextResponse.redirect(channelsUrl(host, { error: 'business_not_found' }));
  }

  const redirectUri = `${host}/api/auth/meta/callback`;

  try {
    // 2. Exchange code for short-lived user token
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?` + new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      }),
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('[meta-oauth] token exchange error:', tokenData.error);
      throw new Error(tokenData.error.message || 'Token exchange failed');
    }
    const shortToken = tokenData.access_token;

    // 3. Exchange short-lived → long-lived user token
    const llRes = await fetch(
      `${GRAPH}/oauth/access_token?` + new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: shortToken,
      }),
    );
    const llData = await llRes.json();
    if (llData.error) {
      console.error('[meta-oauth] long-lived token error:', llData.error);
      throw new Error(llData.error.message || 'Long-lived token exchange failed');
    }
    const longLivedToken = llData.access_token;

    // 4. Discover pages + Instagram accounts
    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username},access_token&access_token=${longLivedToken}`,
    );
    const pagesData = await pagesRes.json();
    if (pagesData.error) {
      console.error('[meta-oauth] pages error:', pagesData.error);
      throw new Error(pagesData.error.message || 'Could not fetch pages');
    }

    const pages = pagesData.data || [];
    if (pages.length === 0) {
      return NextResponse.redirect(channelsUrl(host, {
        error: 'no_pages',
        detail: 'No Facebook Pages found on your account. Create a Page first.',
      }));
    }

    // Pick the first page (v1 — most small businesses have one)
    const page = pages[0];
    const pageToken = page.access_token;
    const facebookPageId = page.id;
    const instagramAccountId = page.instagram_business_account?.id || null;

    // 5. Subscribe page to webhook messages
    try {
      const subRes = await fetch(
        `${GRAPH}/${facebookPageId}/subscribed_apps?` + new URLSearchParams({
          subscribed_fields: 'messages',
          access_token: pageToken,
        }),
        { method: 'POST' },
      );
      const subData = await subRes.json();
      if (!subData.success) {
        console.warn('[meta-oauth] webhook subscribe warning:', subData);
      }
    } catch (subErr) {
      // Non-fatal — webhook can be set up manually
      console.warn('[meta-oauth] webhook subscribe failed:', subErr.message);
    }

    // 6. Store encrypted token + platform IDs
    const updates = {
      facebook_page_id: facebookPageId,
      meta_access_token_enc: encrypt(pageToken),
    };
    if (instagramAccountId) {
      updates.instagram_page_id = instagramAccountId;
    }

    await updateBusiness(business.id, updates);

    console.log(`[meta-oauth] Connected FB page ${facebookPageId}` +
      (instagramAccountId ? ` + IG ${instagramAccountId}` : '') +
      ` for business ${business.id}`);

    // 7. Redirect back to channels page with success
    const connectedPlatforms = instagramAccountId ? 'facebook,instagram' : 'facebook';
    return NextResponse.redirect(channelsUrl(host, {
      connected: 'true',
      platforms: connectedPlatforms,
      page_name: page.name || '',
    }));

  } catch (err) {
    console.error('[meta-oauth] error:', err);
    return NextResponse.redirect(channelsUrl(host, {
      error: 'oauth_failed',
      detail: err.message?.slice(0, 200) || 'Unknown error',
    }));
  }
}
