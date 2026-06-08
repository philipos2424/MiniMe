/**
 * selfImprove.js
 *
 * Weekly self-critique and auto-improvement loop for each business.
 *
 * The bot reads its own recent conversations, identifies patterns in:
 *   - Owner corrections (what the AI said vs. what owner actually sent)
 *   - Unhelpful replies flagged by owner feedback
 *   - Confusion signals (customer repeated themselves, asked the same thing twice)
 *   - Low-confidence replies that got sent anyway
 *
 * Then asks GPT: "Given these patterns, what specific rules / sample replies /
 * knowledge should I add to perform better?"
 *
 * Then IMPLEMENTS the suggestions:
 *   - Adds rules to businesses.owner_instructions
 *   - Updates businesses.sample_replies with better examples
 *   - Creates new embedded knowledge docs for gaps
 *   - Notifies the owner via Telegram with a plain-language summary
 */
import OpenAI from 'openai';
import { supabase } from './db';
import { MODEL_MINI, MODEL, EMBED_MODEL } from './constants';
import crypto from 'node:crypto';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

const LOOKBACK_DAYS = 7;
const MAX_CONVS = 30;
const MAX_MSGS_PER_CONV = 30;

function fingerprint(text) {
  return crypto.createHash('sha1').update((text || '').trim().toLowerCase()).digest('hex').slice(0, 16);
}

// ── 1. Gather evidence ────────────────────────────────────────────────────────
async function gatherEvidence(businessId) {
  const sb = supabase();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

  // Recent conversations
  const { data: convs } = await sb.from('conversations')
    .select('id, customer_id, last_message_at, requires_owner')
    .eq('business_id', businessId)
    .gte('last_message_at', since)
    .order('last_message_at', { ascending: false })
    .limit(MAX_CONVS);
  if (!convs?.length) return null;

  // Owner corrections: outbound messages that were edited by the owner
  const { data: corrections } = await sb.from('messages')
    .select('content, original_content, conversation_id, confidence, created_at')
    .eq('business_id', businessId)
    .eq('direction', 'outbound')
    .eq('owner_edited', true)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(40);

  // Unhelpful feedback
  const { data: badFeedback } = await sb.from('feedback')
    .select('rating, comment, conversation_id, created_at')
    .eq('business_id', businessId)
    .lte('rating', 2)
    .gte('created_at', since)
    .limit(20);

  // Low-confidence auto-sent messages (confidence < 0.65)
  const { data: lowConf } = await sb.from('messages')
    .select('content, confidence, conversation_id, created_at')
    .eq('business_id', businessId)
    .eq('direction', 'outbound')
    .eq('is_ai_generated', true)
    .eq('status', 'sent')
    .lt('confidence', 0.65)
    .gte('created_at', since)
    .limit(20);

  // Build conversation transcripts for the edited ones
  const correctionConvIds = [...new Set((corrections || []).map(c => c.conversation_id).filter(Boolean))].slice(0, 10);
  const transcripts = [];
  for (const convId of correctionConvIds) {
    const { data: msgs } = await sb.from('messages')
      .select('direction, content, is_ai_generated, owner_edited, confidence, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(MAX_MSGS_PER_CONV);
    if (msgs?.length) {
      transcripts.push(msgs.map(m => {
        const who = m.direction === 'inbound' ? 'CUSTOMER' : (m.owner_edited ? 'OWNER (corrected AI)' : m.is_ai_generated ? `AI (conf=${(m.confidence||0).toFixed(2)})` : 'OWNER');
        return `${who}: ${(m.content || '').slice(0, 400)}`;
      }).join('\n'));
    }
  }

  return {
    corrections: corrections || [],
    badFeedback: badFeedback || [],
    lowConf: lowConf || [],
    transcripts,
    conversationCount: convs.length,
  };
}

// ── 2. Ask GPT to critique and suggest improvements ───────────────────────────
async function generateImprovements(business, evidence) {
  const { corrections, badFeedback, lowConf, transcripts, conversationCount } = evidence;

  if (!corrections.length && !badFeedback.length && !transcripts.length) return null;

  const correctionSummary = corrections.length
    ? corrections.slice(0, 10).map((c, i) =>
        `${i + 1}. AI said: "${(c.content || '').slice(0, 200)}"`
      ).join('\n')
    : '(none this week)';

  const feedbackSummary = badFeedback.length
    ? badFeedback.map(f => `- Rating ${f.rating}/5${f.comment ? `: "${f.comment}"` : ''}`).join('\n')
    : '(no negative feedback this week)';

  const transcriptSummary = transcripts.length
    ? transcripts.slice(0, 3).map((t, i) => `=== Conversation ${i + 1} ===\n${t}`).join('\n\n')
    : '(no correction transcripts)';

  const prompt = `You are the AI assistant for "${business.name}" (${business.category || 'business'}).
You have been operating for the past week. Here is a self-review of your performance.

## CORRECTIONS MADE BY OWNER (${corrections.length} this week):
The owner manually changed these AI replies — this means the AI got them wrong:
${correctionSummary}

## NEGATIVE FEEDBACK (${badFeedback.length} this week):
${feedbackSummary}

## CONVERSATIONS WITH CORRECTIONS (for context):
${transcriptSummary}

## BUSINESS CONTEXT:
- Current rules: ${JSON.stringify((business.owner_instructions || []).slice(0, 10).map(r => r.rule))}
- Sample replies count: ${(business.sample_replies || []).length}

## YOUR TASK:
Analyze the patterns. For each recurring issue, propose concrete improvements.

Return JSON (no markdown, just JSON):
{
  "summary": "2-3 sentence plain-English summary of main patterns found this week",
  "new_rules": [
    { "rule": "string — a specific behavior rule, max 80 chars", "reason": "why this helps" }
  ],
  "knowledge_gaps": [
    { "question": "what customers keep asking", "answer": "what the correct answer should be", "why": "brief reason" }
  ],
  "tone_notes": "1 sentence about tone/style adjustments, or null"
}

Constraints:
- new_rules: max 3, only add if there's clear evidence from corrections or feedback
- knowledge_gaps: max 4, only add if customers clearly asked something the AI fumbled
- Be specific, not generic ("always say thank you" is bad; "quote exact price from catalog before asking if they want to proceed" is good)
- If there's nothing concrete to improve, return { "summary": "Good week — no significant patterns found.", "new_rules": [], "knowledge_gaps": [], "tone_notes": null }`;

  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 800,
      messages: [
        { role: 'system', content: 'You are a performance analyst for a Telegram business bot. Be precise, evidence-based, and actionable.' },
        { role: 'user', content: prompt },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  } catch (e) {
    console.error('[selfImprove] GPT critique failed:', e.message);
    return null;
  }
}

// ── 3. Implement improvements ─────────────────────────────────────────────────
async function implementImprovements(business, improvements) {
  if (!improvements) return { rulesAdded: 0, knowledgeAdded: 0 };
  const sb = supabase();
  let rulesAdded = 0;
  let knowledgeAdded = 0;

  // Add new rules (dedupe against existing)
  if (improvements.new_rules?.length) {
    const existing = (business.owner_instructions || []).map(r => r.rule?.toLowerCase());
    const toAdd = improvements.new_rules.filter(r =>
      r.rule && !existing.some(e => e.includes(r.rule.slice(0, 20).toLowerCase()))
    );
    if (toAdd.length) {
      const updated = [
        ...(business.owner_instructions || []),
        ...toAdd.map(r => ({ rule: r.rule, source: 'self_improve', created_at: new Date().toISOString() })),
      ].slice(-30); // cap at 30 rules
      await sb.from('businesses').update({ owner_instructions: updated }).eq('id', business.id);
      rulesAdded = toAdd.length;
    }
  }

  // Add knowledge gap documents
  if (improvements.knowledge_gaps?.length) {
    const { data: existingDocs } = await sb.from('documents')
      .select('meta').eq('business_id', business.id).eq('tag', 'auto-learned');
    const knownFps = new Set((existingDocs || []).map(d => d.meta?.fp).filter(Boolean));

    for (const gap of improvements.knowledge_gaps.slice(0, 4)) {
      if (!gap.question || !gap.answer) continue;
      const text = `Q: ${gap.question}\nA: ${gap.answer}\n(why: ${gap.why || 'self-improvement'})`;
      const fp = fingerprint(`${gap.question}\n${gap.answer}`);
      if (knownFps.has(fp)) continue;

      try {
        const embRes = await openai.embeddings.create({ model: EMBED_MODEL, input: [text] });
        const embedding = embRes.data[0].embedding;

        const { data: doc } = await sb.from('documents').insert({
          business_id: business.id,
          title: gap.question.slice(0, 200),
          tag: 'auto-learned',
          description: gap.answer.slice(0, 400),
          mime_type: 'text/plain',
          original_filename: 'self-improve.txt',
          status: 'embedding',
          meta: { fp, why: gap.why, source: 'self_improve' },
        }).select().single();

        if (doc) {
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
          knowledgeAdded++;
        }
      } catch (e) {
        console.warn('[selfImprove] embedding failed:', e.message);
      }
    }
  }

  return { rulesAdded, knowledgeAdded };
}

// ── 4. Notify owner ───────────────────────────────────────────────────────────
async function notifyOwner(business, botToken, improvements, stats) {
  if (!botToken) return;
  const chatId = business.owner_private_chat_id || business.owner_telegram_id;
  if (!chatId) return;

  const { rulesAdded, knowledgeAdded } = stats;
  const summary = improvements?.summary || 'No significant patterns found this week.';
  const hasChanges = rulesAdded > 0 || knowledgeAdded > 0;

  const lines = [
    `🧠 *Weekly self-review — ${business.name}*`,
    ``,
    summary,
  ];

  if (hasChanges) {
    lines.push(``);
    lines.push(`*What I improved:*`);
    if (rulesAdded > 0) lines.push(`✅ Added ${rulesAdded} new behavior rule${rulesAdded > 1 ? 's' : ''}`);
    if (knowledgeAdded > 0) lines.push(`📚 Added ${knowledgeAdded} knowledge entry${knowledgeAdded > 1 ? 'ies' : 'y'}`);
  }

  if (improvements?.new_rules?.length) {
    lines.push(``);
    lines.push(`*New rules I set for myself:*`);
    improvements.new_rules.forEach(r => lines.push(`• ${r.rule}`));
  }

  if (improvements?.tone_notes) {
    lines.push(``);
    lines.push(`_Tone note: ${improvements.tone_notes}_`);
  }

  if (!hasChanges && !improvements?.new_rules?.length) {
    lines.push(``);
    lines.push(`_Keep teaching me using the Teach page to help me improve further._`);
  }

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: lines.join('\n'),
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(e => console.warn('[selfImprove] notify failed:', e.message));
}

// ── Main entry ────────────────────────────────────────────────────────────────
export async function selfImproveForBusiness(business, botToken) {
  try {
    const evidence = await gatherEvidence(business.id);
    if (!evidence) return { skipped: true, reason: 'no recent conversations' };

    const improvements = await generateImprovements(business, evidence);
    const stats = await implementImprovements(business, improvements);
    await notifyOwner(business, botToken, improvements, stats);

    return {
      skipped: false,
      corrections: evidence.corrections.length,
      badFeedback: evidence.badFeedback.length,
      rulesAdded: stats.rulesAdded,
      knowledgeAdded: stats.knowledgeAdded,
      summary: improvements?.summary || null,
    };
  } catch (e) {
    console.error(`[selfImprove] failed for ${business.name}:`, e.message);
    return { error: e.message };
  }
}
