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
import { supabase } from '../../../../lib/server/db';
import { handleMetaMessage } from '../../../../lib/server/metaReplyEngine';

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

// ── Incoming events ───────────────────────────────────────────────────────────
export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: true }); }

  // Acknowledge immediately — Meta requires < 20s response
  processMetaEvent(body).catch(e => console.error('[meta webhook]', e.message));
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
          if (msg.type === 'text' && msg.text?.body) {
            await handleMetaMessage({
              business: biz,
              platform: 'whatsapp',
              senderId: msg.from,
              senderName: val.contacts?.find(c => c.wa_id === msg.from)?.profile?.name || msg.from,
              messageId: msg.id,
              text: msg.text.body,
              timestamp: msg.timestamp,
            });
          }
          // Ignore delivery receipts (no text)
        }
      }
    }

    // ── Instagram / Facebook Messenger ─────────────────────────────────────
    if (entry.messaging) {
      for (const event of entry.messaging) {
        if (!event.message?.text) continue;
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
