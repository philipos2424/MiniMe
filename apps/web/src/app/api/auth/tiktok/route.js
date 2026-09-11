/**
 * GET /api/auth/tiktok?initData=xxx
 * Starts the TikTok OAuth flow for Business Messaging.
 * Verifies the Telegram initData, encodes businessId into a signed state
 * token, then redirects to TikTok's consent screen.
 */
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { TIKTOK_AUTHORIZE_URL, TIKTOK_SCOPES } from '../../../../lib/server/tiktokLogic.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Build a signed state token: base64({businessId, exp}).hmac */
function signState(businessId) {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY missing');
  const payload = JSON.stringify({ bid: businessId, exp: Date.now() + 5 * 60 * 1000 });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export async function GET(request) {
  const clientKey = (process.env.TIKTOK_CLIENT_KEY || '').trim();
  if (!clientKey) {
    return NextResponse.json({ error: 'TIKTOK_CLIENT_KEY not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const initData = searchParams.get('initData');

  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) {
    return NextResponse.json({ error: 'business not found' }, { status: 404 });
  }

  const host = process.env.WEB_URL || `https://${request.headers.get('host')}`;
  const redirectUri = `${host}/api/auth/tiktok/callback`;

  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set('client_key', clientKey);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', TIKTOK_SCOPES);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', signState(business.id));

  return NextResponse.redirect(url.toString());
}
