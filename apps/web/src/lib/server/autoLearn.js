/**
 * Auto-learn — turns real customer conversations into reusable knowledge.
 *
 * Once a day a cron runs `mineConversationsForBusiness`. For each business
 * it pulls recent active conversations, asks GPT to extract atomic
 * lessons (Q→A pairs + facts that came up), dedupes against what's already
 * been learned, and saves new ones as embedded `documents` rows tagged
 * 'auto-learned'. Future client turns retrieve these via the same
 * KNOWLEDGE BASE block the agent already uses, so Alfred answers similar
 * questions faster and more consistently next time.
 */
import OpenAI from 'openai';
import crypto from 'node:crypto';
import { supabase } from './db';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = 'text-embedding-3-small';

const LOOKBACK_DAYS = 3;       // re-scan recent activity each day
const MAX_CONVS_PER_BUSINESS = 25;
const MAX_TURNS_PER_CONV = 40;

function fingerprint(text) {
  return crypto.createHash('sha1').update((text || '').trim().toLowerCase()).digest('hex').slice(0, 16);
}

async function embedOne(text) {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: [text] });
  return r.data[0].embedding;
}

/**
 * Ask GPT to extract reusable lessons from a single conversation transcript.
 * Returns a list of objects: { question, answer, why_useful }
 */
async function extractLessons(transcript, businessName) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are mining a customer-service transcript for ${businessName} to extract REUSABLE knowledge — things future-AI should remember when answering similar questions.

Return JSON: { "lessons": [{ "question": string, "answer": string, "why_useful": string }] }

Each lesson must be:
- A REAL question a future customer might ask (paraphrase from this transcript, but make it generic — strip the customer's name and any one-off context)
- An ANSWER grounded in what the business actually said in this transcript (or what is clearly true based on it). Do NOT invent.
- "why_useful" = one short reason this is worth remembering ("explains pricing tiers", "clarifies delivery zones", "shows how we handle rush orders", "captures owner's tone for complaints", etc.)

Skip anything that is:
- Specific to one customer (their personal address, their name, their order #)
- Already obvious from a price list
- Off-topic chitchat
- An error / hallucination

If nothing is reusable, return { "lessons": [] }. Cap at 8 lessons.`,
      },
      { role: 'user', content: transcript.slice(0, 12000) },
    ],
  });
  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    return Array.isArray(parsed.lessons) ? parsed.lessons : [];
  } catch {
    return [];
  }
}

/** Format a lesson into a single embedding chunk. */
function formatLesson(l) {
  return `Q: ${l.question}\nA: ${l.answer}\n(why: ${l.why_useful || ''})`;
}

export async function mineConversationsForBusiness(business) {
  const sb = supabase();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

  const { data: convs } = await sb.from('conversations')
    .select('id, customer_id, last_message_at')
    .eq('business_id', business.id)
    .gte('last_message_at', since)
    .order('last_message_at', { ascending: false })
    .limit(MAX_CONVS_PER_BUSINESS);

  if (!convs?.length) return { conversations: 0, lessons: 0, kept: 0, dropped_dupes: 0 };

  // Existing fingerprints to dedupe against (load all auto-learned docs).
  const { data: priorDocs } = await sb.from('documents')
    .select('meta')
    .eq('business_id', business.id)
    .eq('tag', 'auto-learned');
  const knownFps = new Set();
  for (const d of priorDocs || []) {
    if (d.meta?.fp) knownFps.add(d.meta.fp);
  }

  let totalLessons = 0;
  let kept = 0;
  let dropped = 0;

  for (const conv of convs) {
    const { data: msgs } = await sb.from('messages')
      .select('direction, content, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
      .limit(MAX_TURNS_PER_CONV);

    if (!msgs?.length || msgs.length < 4) continue;

    const transcript = msgs
      .map(m => `${m.direction === 'inbound' ? 'CLIENT' : 'BUSINESS'}: ${(m.content || '').slice(0, 600)}`)
      .join('\n');

    let lessons = [];
    try {
      lessons = await extractLessons(transcript, business.name);
    } catch (e) {
      console.warn('extractLessons failed for', conv.id, e.message);
      continue;
    }
    totalLessons += lessons.length;

    for (const l of lessons) {
      if (!l?.question || !l?.answer) continue;
      const text = formatLesson(l);
      const fp = fingerprint(`${l.question}\n${l.answer}`);
      if (knownFps.has(fp)) { dropped++; continue; }

      // Save as document + chunk
      const { data: doc, error } = await sb.from('documents').insert({
        business_id: business.id,
        title: l.question.slice(0, 200),
        tag: 'auto-learned',
        description: l.answer.slice(0, 400),
        mime_type: 'text/plain',
        original_filename: 'auto-learned.txt',
        status: 'embedding',
        meta: { fp, why: l.why_useful, conversation_id: conv.id, source: 'auto-learn' },
      }).select().single();
      if (error || !doc) continue;

      try {
        const embedding = await embedOne(text);
        await sb.from('document_chunks').insert([{
          document_id: doc.id,
          business_id: business.id,
          chunk_index: 0,
          content: text,
          token_count: Math.ceil(text.length / 4),
          embedding,
        }]);
        await sb.from('documents').update({ status: 'ready' }).eq('id', doc.id);
        knownFps.add(fp);
        kept++;
      } catch (e) {
        await sb.from('documents').delete().eq('id', doc.id);
      }
    }
  }

  return { conversations: convs.length, lessons: totalLessons, kept, dropped_dupes: dropped };
}
