/**
 * Conversation memory — keeps Alfred's recall unlimited.
 *
 * Two functions:
 *   1. ensureRollingSummary(conversation, allMessages)
 *      Maintains a compressed synopsis of all turns OLDER than the last 14,
 *      cached on conversations.metadata.long_summary. Recomputed when the
 *      raw count grows past the cached cutoff.
 *
 *   2. fetchPastConversationDigests(businessId, customerId, currentConvId)
 *      For the same customer, pulls 1-line digests of OTHER past
 *      conversations so Alfred can reference what they discussed before.
 *      Digests are produced lazily by digestConversationIfNeeded.
 */
import OpenAI from 'openai';
import { supabase } from './db';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const RECENT_KEEP = 14;          // raw turns kept as-is in prompt
const SUMMARY_REFRESH_AFTER = 6; // re-summarize when this many new old turns accumulate
const PAST_CONVS_LIMIT = 6;      // how many past-convo digests to surface

function turnsToText(msgs) {
  return msgs.map(m => `${m.direction === 'inbound' ? 'CLIENT' : 'ME'}: ${(m.content || '').slice(0, 600)}`).join('\n');
}

async function summarize(text) {
  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    max_tokens: 400,
    messages: [
      { role: 'system', content: `Summarize this customer-service conversation thread into the single most useful synopsis for picking up where it left off. Capture: what the client wants, decisions made, prices/quantities/dates agreed, files exchanged, open questions. Use neutral past tense. 6-12 short lines max. No filler.` },
      { role: 'user', content: text.slice(0, 16000) },
    ],
  });
  return (r.choices[0].message.content || '').trim();
}

export async function ensureRollingSummary(conversation, allMessages) {
  if (!allMessages || allMessages.length <= RECENT_KEEP) return null;

  const cutoff = allMessages.length - RECENT_KEEP;
  const cached = conversation.metadata?.long_summary;
  const cachedAt = conversation.metadata?.long_summary_through ?? 0;

  // Reuse cached summary if not much new content has arrived since.
  if (cached && cutoff - cachedAt < SUMMARY_REFRESH_AFTER) return cached;

  const olderTurns = allMessages.slice(0, cutoff);
  const text = turnsToText(olderTurns);
  let summary = '';
  try {
    summary = await summarize(text);
  } catch (e) {
    return cached || null;
  }
  if (!summary) return cached || null;

  const sb = supabase();
  const newMeta = {
    ...(conversation.metadata || {}),
    long_summary: summary,
    long_summary_through: cutoff,
    long_summary_at: new Date().toISOString(),
  };
  await sb.from('conversations').update({ metadata: newMeta }).eq('id', conversation.id);
  return summary;
}

export async function fetchPastConversationDigests(businessId, customerId, currentConvId) {
  const sb = supabase();
  const { data: convs } = await sb.from('conversations')
    .select('id, last_message_at, metadata')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .neq('id', currentConvId)
    .order('last_message_at', { ascending: false })
    .limit(PAST_CONVS_LIMIT);

  const digests = [];
  for (const c of convs || []) {
    const d = c.metadata?.digest;
    if (d) digests.push({ at: c.last_message_at, digest: d });
    else {
      const fresh = await digestConversationIfNeeded(c.id);
      if (fresh) digests.push({ at: c.last_message_at, digest: fresh });
    }
  }
  return digests;
}

export async function digestConversationIfNeeded(conversationId) {
  const sb = supabase();
  const { data: conv } = await sb.from('conversations').select('id, metadata').eq('id', conversationId).single();
  if (!conv) return null;
  if (conv.metadata?.digest) return conv.metadata.digest;

  const { data: msgs } = await sb.from('messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(120);
  if (!msgs?.length || msgs.length < 2) return null;

  let digest = '';
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 200,
      messages: [
        { role: 'system', content: 'Summarize this past customer-service conversation into ONE compact digest (2-4 short lines). Capture what they wanted, what was agreed, and the outcome. Past tense. No filler.' },
        { role: 'user', content: turnsToText(msgs).slice(0, 12000) },
      ],
    });
    digest = (r.choices[0].message.content || '').trim();
  } catch { return null; }
  if (!digest) return null;

  const newMeta = { ...(conv.metadata || {}), digest, digest_at: new Date().toISOString() };
  await sb.from('conversations').update({ metadata: newMeta }).eq('id', conv.id);
  return digest;
}
