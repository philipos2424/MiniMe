/**
 * metaBackfill.js — import a business's recent Facebook / Instagram DM history
 * after they connect, so the inbox is populated immediately.
 *
 * Owner opt-in only: the connect notification offers an "Import recent
 * history" button (metabf_ callback in replyEngine) — it copies customers'
 * past messages and names into MiniMe, so it never runs automatically.
 * Messages are flagged backfilled:true so no auto-replies fire on history.
 *
 * WhatsApp has no readable message history via the Cloud API, so it is skipped —
 * its inbox fills from the first inbound webhook onward.
 */
import { supabase } from './db';
import { nangoProxy, NANGO_INTEGRATIONS } from './nango';
import { findOrCreateMetaCustomer, findOrCreateConversation } from './metaReplyEngine';

const MAX_CONVERSATIONS = 25;
const MESSAGES_PER_CONVO = 20;

/**
 * @param {object} opts
 * @param {object} opts.business  business row (must have id + nango_connection_id_<platform>)
 * @param {'facebook'|'instagram'} opts.platform
 * @param {string} opts.pageId    the connected page / IG account ID (to identify "us")
 * @returns {Promise<number>} number of conversations imported
 */
export async function backfillMetaConversations({ business, platform, pageId }) {
  if (platform !== 'facebook' && platform !== 'instagram') return 0;
  const connectionId = platform === 'facebook'
    ? business.nango_connection_id_facebook
    : business.nango_connection_id_instagram;
  if (!connectionId || !pageId) return 0;

  const integration = NANGO_INTEGRATIONS[platform];
  const sb = supabase();
  let imported = 0;

  let convos = [];
  try {
    const res = await nangoProxy({
      method: 'GET',
      endpoint: `/${pageId}/conversations`,
      integration,
      connectionId,
      params: {
        platform: platform === 'instagram' ? 'instagram' : 'messenger',
        fields: `participants,messages.limit(${MESSAGES_PER_CONVO}){message,from,created_time}`,
        limit: String(MAX_CONVERSATIONS),
      },
    });
    convos = res?.data || [];
  } catch (e) {
    console.warn(`[metaBackfill] ${platform} conversations fetch failed:`, e.message);
    return 0;
  }

  for (const convo of convos) {
    // The customer is the participant that isn't our page.
    const participant = (convo.participants?.data || []).find(p => p.id && p.id !== pageId);
    if (!participant) continue;

    const senderId = participant.id;
    const senderName = participant.name || participant.username || null;

    let customer, conversation;
    try {
      customer = await findOrCreateMetaCustomer(business.id, platform, senderId, senderName);
      if (!customer) continue;
      conversation = await findOrCreateConversation(business.id, customer.id, platform);
      if (!conversation) continue;
    } catch (e) {
      console.warn('[metaBackfill] customer/convo failed:', e.message);
      continue;
    }

    // Meta returns messages newest-first; insert oldest-first for natural order.
    const msgs = (convo.messages?.data || []).slice().reverse().filter(m => m.message);

    // Dedup on external_id (Meta message id) — one batched lookup per
    // conversation, not one round-trip per message.
    const ids = msgs.map(m => m.id).filter(Boolean);
    let seen = new Set();
    if (ids.length) {
      const { data: rows } = await sb.from('messages').select('external_id').in('external_id', ids);
      seen = new Set((rows || []).map(r => r.external_id));
    }

    let lastAt = null;
    const inserts = [];
    for (const m of msgs) {
      const isFromCustomer = m.from?.id && m.from.id !== pageId;
      const createdAt = m.created_time ? new Date(m.created_time).toISOString() : null;
      if (createdAt) lastAt = createdAt;
      if (m.id && seen.has(m.id)) continue;

      inserts.push({
        conversation_id: conversation.id,
        business_id: business.id,
        customer_id: customer.id,
        direction: isFromCustomer ? 'inbound' : 'outbound',
        content: m.message,
        content_type: 'text',
        platform,
        external_id: m.id || null,
        backfilled: true,
        ...(createdAt ? { created_at: createdAt } : {}),
      });
    }
    if (inserts.length) {
      const { error } = await sb.from('messages').insert(inserts);
      // 23505 = a concurrent insert won the external_id unique race — fine.
      if (error && error.code !== '23505') {
        console.warn('[metaBackfill] insert failed:', error.message);
        continue;
      }
    }

    if (msgs.length) {
      await sb.from('conversations').update({
        message_count: msgs.length,
        ...(lastAt ? { last_message_at: lastAt } : {}),
      }).eq('id', conversation.id);
      imported++;
    }
  }

  return imported;
}
