/**
 * GET  /api/webhook/meta  — Meta webhook verification challenge
 * POST /api/webhook/meta  — Incoming messages from WhatsApp, Instagram, Facebook
 *
 * Meta sends all three platforms to a single webhook URL.
 * We detect platform from the entry shape and route into the same
 * conversation pipeline used by Telegram.
 *
 * Setup:
 *   1. Set META_VERIFY_TOKEN in Vercel env vars (any secret string you choose)
 *   2. In Meta App Dashboard → Webhooks, subscribe to:
 *      - WhatsApp Business: messages
 *      - Instagram: messages, messaging_postbacks
 *      - Facebook Page: messages, messaging_postbacks
 *   3. Set WHATSAPP_PHONE_NUMBER_ID, META_SYSTEM_USER_TOKEN on the business rows
 *      (via /admin settings panel — coming shortly)
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { processMetaEvent } from '../../../../lib/server/metaEvents';
import { rateLimit, getIP } from '../../../../lib/server/rateLimit';

/**
 * Verify Meta's X-Hub-Signature-SHA256 header.
 * Meta signs the raw body with HMAC-SHA256 using the app secret.
 * Returns true if valid (or if META_APP_SECRET is not configured — dev mode).
 */
async function verifyMetaSignature(request, rawBody) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production';
  }
  const sig = request.headers.get('x-hub-signature-256') || request.headers.get('x-hub-signature');
  if (!sig) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  // Constant-time comparison to prevent timing attacks
  try {
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Verification challenge ────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export const maxDuration = 60;

// ── Incoming events ───────────────────────────────────────────────────────────
export async function POST(request) {
  // Rate limit: 100 requests/min per IP
  const { ok, retryAfter } = rateLimit(getIP(request), 'meta-webhook', 100, 60);
  if (!ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });

  // Read raw body first (needed for signature verification)
  let rawBody;
  try { rawBody = await request.text(); } catch { return NextResponse.json({ ok: true }); }

  // Verify Meta signature — reject if META_APP_SECRET is set and sig doesn't match
  if (!await verifyMetaSignature(request, rawBody)) {
    console.warn('[meta webhook] signature verification failed — rejecting');
    return NextResponse.json({ error: 'signature mismatch' }, { status: 401 });
  }

  let body;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: true }); }

  // Process and THEN acknowledge. A processing failure must surface as a
  // non-2xx so Meta retries the delivery — swallowing it here silently drops
  // the customer's message. Deliberate skips (dedup, no business match) don't
  // throw, so retries can't loop on them.
  try {
    await processMetaEvent(body, { source: 'direct' });
  } catch (e) {
    console.error('[meta webhook]', e.message);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
