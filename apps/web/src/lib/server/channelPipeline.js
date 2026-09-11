/**
 * channelPipeline.js — the shared inbound path for every non-Telegram channel.
 *
 * WhatsApp, Instagram, Facebook and TikTok all differ only in *transport*:
 * how a message arrives and how a reply goes back out. Everything between —
 * dedup, customer and conversation upsert, the trial/subscription gate, the
 * draft-vs-auto-send decision, the owner notification — is identical, and the
 * autonomy rules in particular must not drift per channel.
 *
 * So the channel modules (metaReplyEngine, tiktokReplyEngine) own the wire
 * format and hand this module a bound `send`; this module owns the pipeline.
 * Telegram keeps its own richer path in replyEngine.js.
 */
import { supabase } from './db';
import { decrypt } from './crypto';
import { notifyOwnerDraft, notifyOwnerAutoSent } from './notification';

/** customers column holding the per-channel external ID. */
export const CHANNEL_ID_FIELD = {
  whatsapp:  'whatsapp_id',
  instagram: 'instagram_id',
  facebook:  'facebook_id',
  tiktok:    'tiktok_id',
};

/** How each channel is named to the owner in Telegram notifications. */
export const CHANNEL_LABELS = {
  whatsapp:  '📱 WhatsApp',
  instagram: '📸 Instagram',
  facebook:  '👥 Facebook',
  tiktok:    '🎵 TikTok',
};

/** Proper-cased channel name, for the placeholder customer name. */
const CHANNEL_DISPLAY = {
  whatsapp:  'WhatsApp',
  instagram: 'Instagram',
  facebook:  'Facebook',
  tiktok:    'TikTok',
};

/**
 * Find or create the customer behind a channel-native sender ID.
 * @param {object} [extraFields] — channel-specific columns to set on creation
 *   only (e.g. WhatsApp's phone, TikTok's @username). Never overwrites an
 *   existing row, so a customer's edited name survives their next message.
 */
export async function findOrCreateChannelCustomer(businessId, platform, senderId, senderName, extraFields = {}) {
  const sb = supabase();
  const idField = CHANNEL_ID_FIELD[platform];
  if (!idField) return null;

  const { data: existing } = await sb.from('customers')
    .select('*')
    .eq('business_id', businessId)
    .eq(idField, senderId)
    .maybeSingle();
  if (existing) return existing;

  const name = senderName || `${CHANNEL_DISPLAY[platform] || platform} User`;
  const { data, error } = await sb.from('customers').insert({
    business_id: businessId,
    platform,
    [idField]: senderId,
    name,
    ...extraFields,
  }).select().single();

  // Two concurrent first messages race here; the loser re-reads the winner's row.
  if (error?.code === '23505') {
    const { data: raced } = await sb.from('customers')
      .select('*')
      .eq('business_id', businessId)
      .eq(idField, senderId)
      .maybeSingle();
    return raced || null;
  }
  return data;
}

export async function findOrCreateChannelConversation(businessId, customerId, platform) {
  const sb = supabase();
  const { data: existing } = await sb.from('conversations')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .eq('platform', platform)
    .maybeSingle();
  if (existing) return existing;
  const { data } = await sb.from('conversations').insert({
    business_id: businessId,
    customer_id: customerId,
    platform,
    message_count: 0,
  }).select().single();
  return data;
}

/**
 * Run one inbound channel message through the full MiniMe pipeline.
 *
 * The caller is responsible for its own readiness check (a usable token or
 * connection) *before* calling — this function assumes `send` can send.
 *
 * @param {object}   args
 * @param {object}   args.business  — business row, with the BIZ_FIELDS columns
 * @param {string}   args.platform  — 'whatsapp' | 'instagram' | 'facebook' | 'tiktok'
 * @param {string}   args.senderId  — the customer's channel-native ID
 * @param {string}   [args.senderName]
 * @param {string}   [args.messageId] — channel message ID, used for dedup
 * @param {string}   args.text      — message text, already normalized
 * @param {function} args.send      — async ({ recipientId, text }) => void
 * @param {object}   [args.customerFields] — extra columns on customer creation
 * @param {object}   [args.conversationFields] — extra columns to persist on the
 *   conversation each time a message lands (e.g. the channel's thread ID)
 */
export async function handleInboundChannelMessage({
  business, platform, senderId, senderName, messageId, text, send,
  customerFields = {}, conversationFields = {},
}) {
  if (!business || !senderId || !text) return;
  if (business.panic_mode) return;
  if (!CHANNEL_ID_FIELD[platform]) {
    console.warn('[channelPipeline] unknown platform', platform);
    return;
  }

  const sb = supabase();

  // Dedup: skip if we've already processed this message ID.
  if (messageId) {
    const { data: existing } = await sb.from('messages')
      .select('id').eq('external_id', messageId).maybeSingle();
    if (existing) return;
  }

  const customer = await findOrCreateChannelCustomer(business.id, platform, senderId, senderName, customerFields);
  if (!customer) return;
  const conversation = await findOrCreateChannelConversation(business.id, customer.id, platform);
  if (!conversation) return;

  // Save inbound message. The unique index on external_id (see
  // messages_external_id_unique.sql) closes the race the pre-check above
  // can't: two concurrent deliveries of the same retry both pass the select,
  // but only one insert wins — the loser stops here.
  const { error: insErr } = await sb.from('messages').insert({
    conversation_id: conversation.id,
    business_id: business.id,
    customer_id: customer.id,
    direction: 'inbound',
    content: text,
    content_type: 'text',
    platform,
    external_id: messageId || null,
  });
  if (insErr) {
    if (insErr.code === '23505') return; // duplicate delivery — already handled
    throw new Error(`inbound insert failed: ${insErr.message}`);
  }

  // Touch conversation. `conversationFields` carries anything the channel
  // learned from this delivery that the thread needs to keep — TikTok's
  // external_thread_id, for one, without which a later owner reply has no
  // conversation to send into.
  await sb.from('conversations').update({
    last_message_at: new Date().toISOString(),
    message_count: (conversation.message_count || 0) + 1,
    ...conversationFields,
  }).eq('id', conversation.id);

  // Subscription / trial check
  const status = business.subscription_status || 'trial';
  const trialOver = status === 'trial' && business.trial_ends_at && new Date(business.trial_ends_at) < new Date();
  const subExpired = status === 'expired' || status === 'cancelled';
  if ((trialOver || subExpired) && (business.plan_tier || 'free') !== 'free') {
    await send({ recipientId: senderId, text: 'This service is temporarily paused. Please contact the business directly.' });
    return;
  }

  // Same draftReply + shouldAutoSend logic as Telegram.
  try {
    const { draftReply, shouldAutoSend } = await import('./replyEngine');
    const { draft, confidence } = await draftReply(business, customer, conversation, text);
    if (!draft) return;

    // Plan-capped — same autonomy line as Telegram (Free drafts, Pro sends).
    const { effectiveTrustLevel } = await import('../plan');
    const trustLevel = effectiveTrustLevel(business);
    const { detectIntent } = await import('./intent');
    const history = await sb.from('messages')
      .select('direction, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(6)
      .then(r => (r.data || []).reverse());
    const intent = await detectIntent(text, history, { businessId: business?.id });
    const autoSend = shouldAutoSend(trustLevel, confidence, intent);

    const botToken = business.telegram_bot_token_enc
      ? (() => { try { return decrypt(business.telegram_bot_token_enc); } catch { return null; } })()
      : process.env.TELEGRAM_BOT_TOKEN;

    if (autoSend) {
      await send({ recipientId: senderId, text: draft });
      await sb.from('messages').insert({
        conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
        direction: 'outbound', content: draft, content_type: 'text', status: 'sent',
        is_ai_generated: true, platform, sent_at: new Date().toISOString(), confidence,
      });
      await sb.from('conversations').update({ last_ai_action: 'auto_sent', last_message_at: new Date().toISOString() }).eq('id', conversation.id);
      if (botToken) await notifyOwnerAutoSent(botToken, business, customer, text, draft, confidence);
    } else {
      // Save draft, notify owner
      const { data: saved } = await sb.from('messages').insert({
        conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
        direction: 'outbound', content: draft, content_type: 'text', status: 'drafted',
        is_ai_generated: true, platform, confidence,
      }).select().single();
      await sb.from('conversations').update({ requires_owner: true, last_ai_action: 'drafted', last_message_at: new Date().toISOString() }).eq('id', conversation.id);
      if (saved?.id && botToken) {
        const label = CHANNEL_LABELS[platform] || platform;
        await notifyOwnerDraft(botToken, business, customer, `[${label}] ${text}`, draft, confidence, saved.id, intent, null, conversation.id);
      }
    }
  } catch (e) {
    console.error(`[channelPipeline:${platform}] draft failed:`, e.message);
  }
}
