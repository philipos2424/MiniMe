/**
 * metaEvents.js — parse a raw Meta webhook payload (WhatsApp / Instagram /
 * Facebook Messenger) and feed each message into handleMetaMessage.
 *
 * Called from both webhook entry points:
 *   - /api/webhook/meta   (direct from Meta — legacy)
 *   - /api/webhook/nango  (forwarded through Nango)
 */
import { supabase } from './db';
import { handleMetaMessage } from './metaReplyEngine';

const BIZ_FIELDS = 'id, name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, brain_mode, panic_mode, trust_level, notification_prefs, meta_access_token_enc, owner_instructions, sample_replies, nango_connection_id_facebook, nango_connection_id_instagram, nango_connection_id_whatsapp, whatsapp_phone_number_id, instagram_page_id, facebook_page_id, subscription_status, trial_ends_at, plan_tier';

/**
 * @param {object} body — raw Meta webhook payload
 * @param {object} [opts]
 * @param {'direct'|'nango'} [opts.source] — which webhook delivered it. While a
 *   business is dual-connected (legacy Meta webhook + Nango forwarding), the
 *   Nango forward is canonical: the direct webhook skips businesses that have a
 *   Nango connection for the platform, so each event is processed exactly once.
 */
export async function processMetaEvent(body, { source = 'direct' } = {}) {
  if (!body?.entry?.length) return;
  const skipForNango = (biz, platform) =>
    source === 'direct' && !!biz[`nango_connection_id_${platform}`];

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
          .select(BIZ_FIELDS)
          .eq('whatsapp_phone_number_id', phoneNumberId)
          .maybeSingle();
        if (!biz || skipForNango(biz, 'whatsapp')) continue;

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
        // Skip echoes of our own outbound messages
        if (event.message?.is_echo) continue;
        const pageId = entry.id; // Facebook page or Instagram account ID

        const { data: biz } = await supabase()
          .from('businesses')
          .select(BIZ_FIELDS)
          .or(`instagram_page_id.eq.${pageId},facebook_page_id.eq.${pageId}`)
          .maybeSingle();
        if (!biz) continue;

        const platform = biz.instagram_page_id === pageId ? 'instagram' : 'facebook';
        if (skipForNango(biz, platform)) continue;
        await handleMetaMessage({
          business: biz,
          platform,
          senderId: event.sender?.id,
          senderName: null, // resolved later via Graph API if needed
          messageId: event.message.mid,
          text,
          timestamp: event.timestamp,
          replyToId: event.message.reply_to?.mid,
        });
      }
    }
  }
}
