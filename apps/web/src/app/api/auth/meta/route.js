/**
 * GET /api/auth/meta?initData=xxx
 * Starts the Facebook OAuth flow.
 * Verifies the Telegram initData, encodes businessId into a signed state JWT,
 * then redirects to Facebook's OAuth dialog.
 */
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const META_APP_ID = process.env.META_APP_ID;
const SCOPES = 'pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages';

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
  if (!META_APP_ID) {
    return NextResponse.json({ error: 'META_APP_ID not configured' }, { status: 500 });
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

  const state = signState(business.id);

  // Build redirect URI — use WEB_URL or derive from Host header
  const host = process.env.WEB_URL
    || `https://${request.headers.get('host')}`;
  const redirectUri = `${host}/api/auth/meta/callback`;

  const fbUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  fbUrl.searchParams.set('client_id', META_APP_ID);
  fbUrl.searchParams.set('redirect_uri', redirectUri);
  fbUrl.searchParams.set('scope', SCOPES);
  fbUrl.searchParams.set('state', state);
  fbUrl.searchParams.set('response_type', 'code');

  return NextResponse.redirect(fbUrl.toString());
}
