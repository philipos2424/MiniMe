/**
 * metaReplyEngine.js
 *
 * Handles incoming messages from WhatsApp, Instagram, and Facebook Messenger.
 * Reuses the same AI pipeline (draftReply, intent, RAG) as the Telegram engine.
 * Replies are sent back through the Meta Graph API.
 *
 * Platform → reply method:
 *   whatsapp  → POST /v21.0/{phone_number_id}/messages
 *   instagram → POST /v21.0/me/messages (with page access token)
 *   facebook  → POST /v21.0/me/messages (with page access token)
 */
import { supabase } from './db';
import { decrypt } from './crypto';
import { nangoProxy, NANGO_INTEGRATIONS } from './nango';
import {
  findOrCreateChannelCustomer,
  findOrCreateChannelConversation,
  handleInboundChannelMessage,
} from './channelPipeline';

const META_API = 'https://graph.facebook.com/v21.0';

/**
 * The Nango connection ID for a platform on this business, if connected.
 * WhatsApp is deliberately absent — it's deferred this phase (legacy token
 * only; sessions in /api/nango/session only allow FB/IG).
 */
function nangoConnectionFor(business, platform) {
  if (platform === 'instagram') return business.nango_connection_id_instagram || null;
  if (platform === 'facebook') return business.nango_connection_id_facebook || null;
  return null;
}

// ── Meta send helpers ─────────────────────────────────────────────────────────
// Each helper prefers the Nango proxy (fresh tokens, no local secrets) and falls
// back to a direct Graph call with the legacy encrypted token when the business
// has not migrated to a Nango connection yet.

function whatsAppBody(to, text) {
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
}

async function sendWhatsApp({ business, phoneNumberId, accessToken, to, text }) {
  const pnid = phoneNumberId || business?.whatsapp_phone_number_id;
  const r = await fetch(`${META_API}/${pnid}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(whatsAppBody(to, text)),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'WhatsApp send failed');
  return j;
}

async function sendInstagramOrFacebook({ business, platform, accessToken, recipientId, text }) {
  const conn = nangoConnectionFor(business, platform);
  if (conn) {
    return nangoProxy({
      method: 'POST',
      endpoint: '/me/messages',
      integration: NANGO_INTEGRATIONS[platform],
      connectionId: conn,
      data: { recipient: { id: recipientId }, message: { text } },
    });
  }
  const r = await fetch(`${META_API}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Meta send failed');
  return j;
}

async function metaSend({ business, platform, recipientId, text, accessToken, phoneNumberId }) {
  if (platform === 'whatsapp') {
    return sendWhatsApp({ business, phoneNumberId, accessToken, to: recipientId, text });
  }
  return sendInstagramOrFacebook({ business, platform, accessToken, recipientId, text });
}

// ── Resolve Meta access token ─────────────────────────────────────────────────
function resolveAccessToken(business) {
  if (!business.meta_access_token_enc) return process.env.META_SYSTEM_USER_TOKEN || null;
  try { return decrypt(business.meta_access_token_enc); } catch { return null; }
}

// ── Find or create customer ───────────────────────────────────────────────────
// The upsert and pipeline logic is shared with the other non-Telegram channels
// (see channelPipeline.js); these wrappers keep the Meta-specific bits — the
// WhatsApp sender ID doubling as a phone number — and the existing call sites
// in metaBackfill.js working unchanged.
export async function findOrCreateMetaCustomer(businessId, platform, senderId, senderName) {
  // For WhatsApp, the senderId IS the customer's phone number (e.g. "251912345678")
  const phone = platform === 'whatsapp' && /^\d{7,15}$/.test(senderId) ? `+${senderId}` : undefined;
  return findOrCreateChannelCustomer(
    businessId, platform, senderId, senderName,
    phone ? { phone, phone_verified: true } : {},
  );
}

export async function findOrCreateConversation(businessId, customerId, platform) {
  return findOrCreateChannelConversation(businessId, customerId, platform);
}

// ── Main entry ────────────────────────────────────────────────────────────────
export async function handleMetaMessage({ business, platform, senderId, senderName, messageId, text, timestamp }) {
  if (!business || !senderId || !text) return;

  // Readiness check before the pipeline touches anything: without a token or a
  // Nango connection we could ingest the message but never answer it.
  const accessToken = resolveAccessToken(business);
  const hasNango = !!nangoConnectionFor(business, platform);
  if (!accessToken && !hasNango) {
    console.warn('[metaReplyEngine] no access token or Nango connection for business', business.id);
    return;
  }

  // For WhatsApp, the senderId IS the customer's phone number (e.g. "251912345678")
  const phone = platform === 'whatsapp' && /^\d{7,15}$/.test(senderId) ? `+${senderId}` : undefined;

  return handleInboundChannelMessage({
    business, platform, senderId, senderName, messageId, text,
    customerFields: phone ? { phone, phone_verified: true } : {},
    send: ({ recipientId, text: body }) => metaSend({ business, platform, recipientId, text: body, accessToken }),
  });
}

/**
 * Send a reply from the owner through the correct Meta platform.
 * Called by the reply API route when owner sends from Mini App.
 */
export async function sendMetaReply({ business, conversation, text }) {
  const platform = conversation.platform;
  if (!platform || platform === 'telegram') return null;
  // TikTok is not a Meta channel — see tiktokReplyEngine.sendTikTokReply.
  if (!['whatsapp', 'instagram', 'facebook'].includes(platform)) {
    throw new Error(`sendMetaReply called for non-Meta platform "${platform}"`);
  }

  const accessToken = resolveAccessToken(business);
  if (!accessToken && !nangoConnectionFor(business, platform)) {
    throw new Error('No Meta connection configured');
  }

  // Find recipient external ID from the customer row
  const sb = supabase();
  const { data: customer } = await sb.from('customers')
    .select('whatsapp_id, instagram_id, facebook_id')
    .eq('id', conversation.customer_id)
    .maybeSingle();

  const recipientId = platform === 'whatsapp' ? customer?.whatsapp_id
    : platform === 'instagram' ? customer?.instagram_id
    : customer?.facebook_id;
  if (!recipientId) throw new Error('Customer external ID not found');

  return metaSend({ business, platform, recipientId, text, accessToken });
}
