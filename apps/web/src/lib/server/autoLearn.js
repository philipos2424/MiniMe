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
import { makeOpenAI } from './openaiClient';
import { MODEL_MINI, EMBED_MODEL } from './constants';
import crypto from 'node:crypto';
import { supabase } from './db';

const openai = makeOpenAI();

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
    model: MODEL_MINI,
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

/**
 * Scan recent inbound messages for questions with no knowledge base match.
 * Collects the recurring gap topics and sends a single Telegram notification
 * to the owner so they know what to teach.
 */
export async function detectAndNotifyKnowledgeGaps(business, botToken) {
  if (!botToken || !business.owner_private_chat_id && !business.owner_telegram_id) return;
  const sb = supabase();
  const since = new Date(Date.now() - 7 * 86400000).toISOString(); // last 7 days

  // Pull inbound messages — up to 80 recent ones
  const { data: msgs } = await sb.from('messages')
    .select('content, conversation_id')
    .eq('business_id', business.id)
    .eq('direction', 'inbound')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(80);

  if (!msgs?.length) return;

  // Collect all inbound message texts and let GPT identify recurring gaps
  const gaps = msgs
    .filter(m => m.content && m.content.length >= 8)
    .map(m => m.content.slice(0, 200));
  if (gaps.length < 5) return; // not enough data

  // Ask GPT to identify recurring topics the owner hasn't taught yet
  try {
    const res = await openai.chat.completions.create({
      model: MODEL_MINI,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `You are analyzing customer messages for a small business bot. Find the TOP 3 recurring topics/questions that customers keep asking. These are things the business owner should teach the bot about.
Return JSON: { "gaps": [{ "topic": string, "example": string, "count_approx": number }] }
Focus on specific, actionable topics (not greetings or one-word messages). If no clear patterns, return { "gaps": [] }.`,
        },
        { role: 'user', content: `Recent customer messages:\n${gaps.slice(0, 50).map((g, i) => `${i + 1}. "${g}"`).join('\n')}` },
      ],
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    if (!Array.isArray(parsed.gaps) || !parsed.gaps.length) return;

    // Send notification to owner
    const ownerChatId = business.owner_private_chat_id || business.owner_telegram_id;
    const gapLines = parsed.gaps.slice(0, 3).map((g, i) =>
      `${i + 1}. *${g.topic}*${g.example ? `\n   e.g. "${g.example.slice(0, 80)}"` : ''}`
    ).join('\n\n');

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ownerChatId,
        parse_mode: 'Markdown',
        text: `🧠 *MiniMe noticed knowledge gaps this week*\n\nCustomers kept asking about things I don't know yet:\n\n${gapLines}\n\n💡 Tap *Teach* in settings to fill these in — I'll answer better next time.`,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.warn('[autoLearn] gap notification failed:', e.message);
  }
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

    // Filter to new lessons before doing any DB/embedding work
    const newLessons = lessons.filter(l => {
      if (!l?.question || !l?.answer) return false;
      const fp = fingerprint(`${l.question}\n${l.answer}`);
      if (knownFps.has(fp)) { dropped++; return false; }
      return true;
    });
    if (!newLessons.length) continue;

    // ── Batch embed all new lessons in a single API call ─────────────────────
    const texts = newLessons.map(formatLesson);
    let embeddings = [];
    try {
      const res = await openai.embeddings.create({ model: EMBED_MODEL, input: texts });
      embeddings = res.data.map(d => d.embedding);
    } catch (e) {
      console.warn('batch embed failed for conv', conv.id, e.message);
      continue;
    }

    // Save each lesson + its pre-computed embedding
    for (let i = 0; i < newLessons.length; i++) {
      const l = newLessons[i];
      const text = texts[i];
      const fp = fingerprint(`${l.question}\n${l.answer}`);
      const embedding = embeddings[i];
      if (!embedding) continue;

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

/**
 * Save a single Q→A lesson as an embedded `documents` row, reusing the same
 * store and dedupe fingerprint as the daily miner. Used by the real-time
 * owner-correction path (replyEngine → saveFaqPair → here) so corrections get
 * durable, paraphrase-robust semantic recall — not just exact FAQ matching.
 *
 * Idempotent: if an auto-learned doc with the same fingerprint already exists
 * for this business, this is a no-op. Best-effort: errors are swallowed so a
 * RAG-write failure can never break the owner-reply path.
 */
export async function saveLessonAsDocument(businessId, question, answer, { source = 'owner-correction' } = {}) {
  try {
    if (!businessId || !question || !answer) return;
    const sb = supabase();
    const q = String(question).trim();
    const a = String(answer).trim();
    if (q.length < 4 || a.length < 4) return;

    const text = `Q: ${q}\nA: ${a}`;
    const fp = fingerprint(`${q}\n${a}`);

    // Dedupe against existing auto-learned docs (same fp logic as the miner).
    const { data: prior } = await sb.from('documents')
      .select('id, meta')
      .eq('business_id', businessId)
      .eq('tag', 'auto-learned');
    if ((prior || []).some(d => d.meta?.fp === fp)) return;

    const embedding = await embedOne(text);

    const { data: doc, error } = await sb.from('documents').insert({
      business_id: businessId,
      title: q.slice(0, 200),
      tag: 'auto-learned',
      description: a.slice(0, 400),
      mime_type: 'text/plain',
      original_filename: 'owner-correction.txt',
      status: 'embedding',
      meta: { fp, source },
    }).select().single();
    if (error || !doc) return;

    try {
      await sb.from('document_chunks').insert([{
        document_id: doc.id,
        business_id: businessId,
        chunk_index: 0,
        content: text,
        token_count: Math.ceil(text.length / 4),
        embedding,
      }]);
      await sb.from('documents').update({ status: 'ready' }).eq('id', doc.id);
      console.log(`[learn] embedded owner correction as document for business ${businessId}`);
    } catch (e) {
      // Roll back the orphan doc row if chunk insert/embed save failed.
      await sb.from('documents').delete().eq('id', doc.id);
      console.warn('[saveLessonAsDocument] chunk insert failed:', e.message);
    }
  } catch (e) {
    console.warn('[saveLessonAsDocument] failed (non-fatal):', e.message);
  }
}
