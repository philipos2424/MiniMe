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
import { notifyOwnerDraft, notifyOwnerAutoSent } from './notification';

const META_API = 'https://graph.facebook.com/v21.0';

// ── Meta send helpers ─────────────────────────────────────────────────────────
async function sendWhatsApp({ phoneNumberId, accessToken, to, text }) {
  const r = await fetch(`${META_API}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'WhatsApp send failed');
  return j;
}

async function sendInstagramOrFacebook({ accessToken, recipientId, text }) {
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
    return sendWhatsApp({ phoneNumberId: phoneNumberId || business.whatsapp_phone_number_id, accessToken, to: recipientId, text });
  }
  return sendInstagramOrFacebook({ accessToken, recipientId, text });
}

// ── Resolve Meta access token ─────────────────────────────────────────────────
function resolveAccessToken(business) {
  if (!business.meta_access_token_enc) return process.env.META_SYSTEM_USER_TOKEN || null;
  try { return decrypt(business.meta_access_token_enc); } catch { return null; }
}

// ── Find or create customer ───────────────────────────────────────────────────
async function findOrCreateMetaCustomer(businessId, platform, senderId, senderName) {
  const sb = supabase();
  const idField = platform === 'whatsapp' ? 'whatsapp_id'
    : platform === 'instagram' ? 'instagram_id'
    : 'facebook_id';

  // Try to find existing
  const { data: existing } = await sb.from('customers')
    .select('*')
    .eq('business_id', businessId)
    .eq(idField, senderId)
    .maybeSingle();
  if (existing) return existing;

  // Create new
  const name = senderName || `${platform.charAt(0).toUpperCase() + platform.slice(1)} User`;
  // For WhatsApp, the senderId IS the customer's phone number (e.g. "251912345678")
  const phone = platform === 'whatsapp' && /^\d{7,15}$/.test(senderId) ? `+${senderId}` : undefined;
  const { data } = await sb.from('customers').insert({
    business_id: businessId,
    platform,
    [idField]: senderId,
    name,
    ...(phone ? { phone, phone_verified: true } : {}),
  }).select().single();
  return data;
}

async function findOrCreateConversation(businessId, customerId, platform) {
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

// ── Main entry ────────────────────────────────────────────────────────────────
export async function handleMetaMessage({ business, platform, senderId, senderName, messageId, text, timestamp }) {
  if (!business || !senderId || !text) return;
  if (business.panic_mode) return;

  const sb = supabase();

  // Dedup: skip if we've already processed this message ID
  if (messageId) {
    const { data: existing } = await sb.from('messages')
      .select('id').eq('external_id', messageId).maybeSingle();
    if (existing) return;
  }

  const accessToken = resolveAccessToken(business);
  if (!accessToken) {
    console.warn('[metaReplyEngine] no access token for business', business.id);
    return;
  }

  const customer = await findOrCreateMetaCustomer(business.id, platform, senderId, senderName);
  if (!customer) return;
  const conversation = await findOrCreateConversation(business.id, customer.id, platform);
  if (!conversation) return;

  // Save inbound message
  await sb.from('messages').insert({
    conversation_id: conversation.id,
    business_id: business.id,
    customer_id: customer.id,
    direction: 'inbound',
    content: text,
    content_type: 'text',
    platform,
    external_id: messageId || null,
  });

  // Touch conversation
  await sb.from('conversations').update({
    last_message_at: new Date().toISOString(),
    message_count: (conversation.message_count || 0) + 1,
  }).eq('id', conversation.id);

  // Subscription / trial check
  const status = business.subscription_status || 'trial';
  const trialOver = status === 'trial' && business.trial_ends_at && new Date(business.trial_ends_at) < new Date();
  const subExpired = status === 'expired' || status === 'cancelled';
  if ((trialOver || subExpired) && (business.plan_tier || 'free') !== 'free') {
    await metaSend({ business, platform, recipientId: senderId, text: "This service is temporarily paused. Please contact the business directly.", accessToken });
    return;
  }

  // Use the same draftReply + shouldAutoSend logic as Telegram
  try {
    const { draftReply, shouldAutoSend, TRUST_LEVELS } = await import('./replyHelpers');
    const { draft, confidence } = await draftReply(business, customer, conversation, text);
    if (!draft) return;

    const trustLevel = Number(business.trust_level ?? 0);
    const { detectIntent } = await import('./intent');
    const history = await sb.from('messages')
      .select('direction, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(6)
      .then(r => (r.data || []).reverse());
    const intent = await detectIntent(text, history);
    const autoSend = shouldAutoSend(trustLevel, confidence, intent);

    const botToken = business.telegram_bot_token_enc
      ? (() => { try { return decrypt(business.telegram_bot_token_enc); } catch { return null; } })()
      : process.env.TELEGRAM_BOT_TOKEN;

    if (autoSend) {
      await metaSend({ business, platform, recipientId: senderId, text: draft, accessToken });
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
        const platformLabel = platform === 'whatsapp' ? '📱 WhatsApp' : platform === 'instagram' ? '📸 Instagram' : '👥 Facebook';
        await notifyOwnerDraft(botToken, business, customer, `[${platformLabel}] ${text}`, draft, confidence, saved.id, intent, null, conversation.id);
      }
    }
  } catch (e) {
    console.error('[metaReplyEngine] draft failed:', e.message);
  }
}

/**
 * Send a reply from the owner through the correct Meta platform.
 * Called by the reply API route when owner sends from Mini App.
 */
export async function sendMetaReply({ business, conversation, text }) {
  const platform = conversation.platform;
  if (!platform || platform === 'telegram') return null;

  const accessToken = resolveAccessToken(business);
  if (!accessToken) throw new Error('No Meta access token configured');

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
