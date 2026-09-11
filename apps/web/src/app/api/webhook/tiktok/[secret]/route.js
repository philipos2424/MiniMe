/**
 * GET  /api/webhook/tiktok/<secret> — TikTok's subscription verification echo
 * POST /api/webhook/tiktok/<secret> — incoming TikTok Business Messaging events
 *
 * The URL carries a shared secret, the same shape the multi-tenant Telegram
 * webhook uses (/api/telegram/webhook/[secret]). That is the guard that does
 * not depend on TikTok's signature scheme: a caller who does not know the
 * secret never reaches the handler.
 *
 * Setup:
 *   1. Set TIKTOK_WEBHOOK_PATH_SECRET (any long random string) in Vercel.
 *   2. Register this URL — including the secret — as the webhook for your
 *      TikTok app's Business Messaging events.
 *   3. Optionally set TIKTOK_WEBHOOK_SECRET to also enforce TikTok's HMAC
 *      signature once you have confirmed the scheme in the developer portal.
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { processTikTokEvent } from '../../../../../lib/server/tiktokEvents';
import { verifyWebhookSignature } from '../../../../../lib/server/tiktokApi';
import { rateLimit, getIP } from '../../../../../lib/server/rateLimit';
import { logWebhookEvent } from '../../../../../lib/server/webhookHealth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const isProd = () => process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

/**
 * Constant-time check of the path secret.
 * With no secret configured we accept outside production only, matching the
 * Meta webhook's dev-mode posture — production always fails closed.
 */
function pathSecretOk(secret) {
  const expected = (process.env.TIKTOK_WEBHOOK_PATH_SECRET || '').trim();
  if (!expected) return !isProd();
  const given = String(secret || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

// ── Verification echo ─────────────────────────────────────────────────────────
// TikTok confirms a webhook URL by requesting it and expecting the challenge
// value back verbatim. Nothing here is secret, but it still sits behind the
// path secret so the endpoint stays unlisted.
export async function GET(request, { params }) {
  if (!pathSecretOk(params?.secret)) return new Response('Forbidden', { status: 403 });

  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('challenge')
    || searchParams.get('hub.challenge')
    || searchParams.get('echostr');
  if (challenge) return new Response(challenge, { status: 200 });

  return NextResponse.json({ ok: true });
}

// ── Incoming events ───────────────────────────────────────────────────────────
export async function POST(request, { params }) {
  const started = Date.now();

  // Same budget as the Meta webhook: 100 requests/min per IP.
  const { ok, retryAfter } = rateLimit(getIP(request), 'tiktok-webhook', 100, 60);
  if (!ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  }

  if (!pathSecretOk(params?.secret)) {
    console.warn('[tiktok webhook] bad path secret — rejecting');
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Raw body first — an HMAC check has to see the bytes TikTok signed.
  let rawBody;
  try { rawBody = await request.text(); } catch { return NextResponse.json({ ok: true }); }

  const sig = verifyWebhookSignature(request, rawBody);
  if (!sig.ok) {
    console.warn('[tiktok webhook] signature verification failed:', sig.reason);
    return NextResponse.json({ error: 'signature mismatch' }, { status: 401 });
  }

  let body;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: true }); }

  // Process and THEN acknowledge. A processing failure must surface as a
  // non-2xx so TikTok retries — swallowing it silently drops the customer's
  // message. Deliberate skips (dedup, unknown business) don't throw, so
  // retries can't loop on them.
  try {
    const { processed, skipped } = await processTikTokEvent(body);
    if (!processed && skipped.length) {
      // Nothing was actionable. Log why — this is the first thing to read when
      // TikTok is delivering but no conversations appear.
      console.warn('[tiktok webhook] no messages processed:', skipped.join('; '));
    }
    logWebhookEvent({
      delivery_status: 'success',
      response_time_ms: Date.now() - started,
      http_status: 200,
    });
    return NextResponse.json({ ok: true, processed });
  } catch (e) {
    console.error('[tiktok webhook]', e.message);
    logWebhookEvent({
      delivery_status: 'failed',
      response_time_ms: Date.now() - started,
      http_status: 500,
      error_message: e.message,
    });
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
