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
import { supabase } from '../../../../lib/server/db';
import { handleMetaMessage } from '../../../../lib/server/metaReplyEngine';
import { rateLimit, getIP } from '../../../../lib/server/rateLimit';

/**
 * Verify Meta's X-Hub-Signature-SHA256 header.
 * Meta signs the raw body with HMAC-SHA256 using the app secret.
 * Returns true if valid (or if META_APP_SECRET is not configured — dev mode).
 */
async function verifyMetaSignature(request, rawBody) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true; // dev / not configured — skip
  const sig = request.headers.get('x-hub-signature-256') || request.headers.get('x-hub-signature');
  if (!sig) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
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

  // Process and THEN acknowledge — so Meta retries on failure
  try {
    await processMetaEvent(body);
  } catch (e) {
    console.error('[meta webhook]', e.message);
  }
  return NextResponse.json({ ok: true });
}

async function processMetaEvent(body) {
  if (!body?.entry?.length) return;

  for (const entry of body.entry) {
    // ── WhatsApp ────────────────────────────────────────────────────────────
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const val = change.value;
        const phoneNumberId = val.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        // Find the business by whatsapp_phone_number_id
        const { data: biz } = await supabase()
          .from('businesses')
          .select('id, name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, brain_mode, panic_mode, trust_level, notification_prefs, meta_access_token_enc, owner_instructions, sample_replies')
          .eq('whatsapp_phone_number_id', phoneNumberId)
          .maybeSingle();
        if (!biz) continue;

        for (const msg of val.messages || []) {
          // Extract text content — support text, image captions, voice, documents
          let text = null;
          if (msg.type === 'text' && msg.text?.body) {
            text = msg.text.body;
          } else if (msg.type === 'image') {
            text = msg.image?.caption ? `[Customer sent an image] ${msg.image.caption}` : '[Customer sent an image]';
          } else if (msg.type === 'video') {
            text = msg.video?.caption ? `[Customer sent a video] ${msg.video.caption}` : '[Customer sent a video]';
          } else if (msg.type === 'audio' || msg.type === 'voice') {
            text = '[Customer sent a voice message]';
          } else if (msg.type === 'document') {
            text = `[Customer sent a document: ${msg.document?.filename || 'file'}]`;
          } else if (msg.type === 'sticker') {
            text = msg.sticker?.emoji ? `[Sticker: ${msg.sticker.emoji}]` : '[Customer sent a sticker]';
          } else if (msg.type === 'location') {
            text = `[Customer shared a location: ${msg.location?.latitude}, ${msg.location?.longitude}]`;
          }
          // Skip delivery receipts and unsupported types
          if (!text) continue;

          await handleMetaMessage({
            business: biz,
            platform: 'whatsapp',
            senderId: msg.from,
            senderName: val.contacts?.find(c => c.wa_id === msg.from)?.profile?.name || msg.from,
            messageId: msg.id,
            text,
            timestamp: msg.timestamp,
          });
        }
      }
    }

    // ── Instagram / Facebook Messenger ─────────────────────────────────────
    if (entry.messaging) {
      for (const event of entry.messaging) {
        // Extract text — support text messages and attachments with fallback
        let text = event.message?.text || null;
        if (!text && event.message?.attachments?.length) {
          const att = event.message.attachments[0];
          const typeLabel = att.type === 'image' ? 'an image' : att.type === 'video' ? 'a video'
            : att.type === 'audio' ? 'a voice message' : att.type === 'file' ? 'a file' : 'an attachment';
          text = `[Customer sent ${typeLabel}]`;
        }
        if (!text) continue;
        const pageId = entry.id; // Facebook page or Instagram account ID

        const { data: biz } = await supabase()
          .from('businesses')
          .select('id, name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, brain_mode, panic_mode, trust_level, notification_prefs, meta_access_token_enc, owner_instructions, sample_replies, instagram_page_id, facebook_page_id')
          .or(`instagram_page_id.eq.${pageId},facebook_page_id.eq.${pageId}`)
          .maybeSingle();
        if (!biz) continue;

        const platform = biz.instagram_page_id === pageId ? 'instagram' : 'facebook';
        await handleMetaMessage({
          business: biz,
          platform,
          senderId: event.sender?.id,
          senderName: null, // resolved later via Graph API if needed
          messageId: event.message.mid,
          text: event.message.text,
          timestamp: event.timestamp,
          replyToId: event.message.reply_to?.mid,
        });
      }
    }
  }
}
