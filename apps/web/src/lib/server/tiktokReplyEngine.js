/**
 * tiktokReplyEngine.js
 *
 * Handles incoming TikTok Business Messaging DMs and sends replies back.
 * The AI pipeline (draftReply, intent, RAG, autonomy) is the shared one in
 * channelPipeline.js — this module owns only the TikTok-specific parts:
 * resolving a token, addressing the thread, and splitting a reply to fit
 * TikTok's shorter per-message limit.
 *
 * Reply path: POST {TIKTOK_ENDPOINTS.sendMessage} with the conversation_id
 * TikTok gave us on the inbound webhook.
 */
import { supabase } from './db';
import { handleInboundChannelMessage } from './channelPipeline';
import { getAccessToken, sendMessage } from './tiktokApi';
import { chunkForTikTok } from './tiktokLogic.mjs';

/**
 * Send `text` as one or more DMs, respecting TikTok's per-message ceiling.
 * Chunks go out in order and stop at the first failure, so a partially
 * delivered reply surfaces as an error rather than silently truncating.
 */
async function sendChunked({ token, businessId, conversationId, recipientId, text }) {
  const chunks = chunkForTikTok(text);
  if (!chunks.length) return null;
  let last = null;
  for (const chunk of chunks) {
    last = await sendMessage({ token, businessId, conversationId, recipientId, text: chunk });
  }
  return last;
}

/**
 * Entry point for one inbound TikTok DM.
 *
 * @param {object} args
 * @param {object} args.business        — business row (needs the tiktok_* columns)
 * @param {string} args.senderId        — customer's TikTok open_id
 * @param {string} [args.senderName]    — TikTok nickname, when the payload has one
 * @param {string} [args.messageId]     — used for dedup
 * @param {string} [args.conversationId]— TikTok thread ID, needed to reply
 * @param {string} args.text            — normalized message text
 */
export async function handleTikTokMessage({ business, senderId, senderName, messageId, conversationId, text }) {
  if (!business || !senderId || !text) return;

  // Readiness check before the pipeline touches anything: with no usable token
  // we could ingest the message but never answer it.
  const token = await getAccessToken(business);
  if (!token) {
    console.warn('[tiktokReplyEngine] no usable access token for business', business.id);
    return;
  }

  return handleInboundChannelMessage({
    business,
    platform: 'tiktok',
    senderId,
    senderName,
    messageId,
    text,
    customerFields: senderName ? { tiktok_username: senderName } : {},
    conversationFields: conversationId ? { external_thread_id: conversationId } : {},
    send: ({ recipientId, text: body }) => sendChunked({
      token,
      businessId: business.tiktok_business_id,
      conversationId,
      recipientId,
      text: body,
    }),
  });
}

/**
 * Send a reply from the owner into a TikTok thread.
 * Called by the reply API route when the owner sends from the Mini App.
 */
export async function sendTikTokReply({ business, conversation, text }) {
  if (conversation?.platform !== 'tiktok') return null;

  const token = await getAccessToken(business);
  if (!token) throw new Error('TikTok is not connected for this business');

  const sb = supabase();
  const { data: customer } = await sb.from('customers')
    .select('tiktok_id')
    .eq('id', conversation.customer_id)
    .maybeSingle();

  const conversationId = conversation.external_thread_id || null;
  const recipientId = customer?.tiktok_id || null;
  if (!conversationId && !recipientId) {
    throw new Error('No TikTok thread on this conversation');
  }

  return sendChunked({
    token,
    businessId: business.tiktok_business_id,
    conversationId,
    recipientId,
    text,
  });
}
