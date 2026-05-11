/**
 * AI Advisor — the owner's personal business consultant.
 *
 * NOT a customer chatbot. Reads the business's live state (clients, deals,
 * jobs, response stats, agent actions) and answers owner questions with
 * concrete names, ETB amounts, and one clear next action.
 *
 * Entry points:
 *   - getAdvisorContext(businessId)
 *   - buildAdvisorPrompt(context, question)
 *   - generateAdvisorResponse(businessId, question)   ← the one to call
 *   - formatForTelegram(text)
 */
import OpenAI from 'openai';
import { supabase } from './db';
import { retrieveRelevantChunks } from './knowledge';
import { MODEL } from './constants';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ────────────────────────────── Context ──────────────────────────────
export async function getAdvisorContext(businessId) {
  const sb = supabase();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [
    { data: business },
    { data: customers },
    { data: msgs },
    { data: jobs },
    { data: thoughts },
    { data: orders },
    { data: products },
  ] = await Promise.all([
    sb.from('businesses').select('id, name, category, plan_tier, trust_level, language, owner_name, business_hours, website, portfolio_url, instagram').eq('id', businessId).single(),
    sb.from('customers').select('id, name, telegram_username, tier, sentiment_avg, language_preference, total_spent, total_orders, last_active_at, last_order_at, tags, ai_notes, owner_notes')
      .eq('business_id', businessId)
      .order('last_active_at', { ascending: false })
      .limit(40),
    sb.from('messages').select('direction, is_ai_generated, owner_edited, edit_distance, created_at, sent_at')
      .eq('business_id', businessId)
      .gte('created_at', weekAgo)
      .limit(500),
    sb.from('jobs').select('id, title, status, current_step, budget, currency, deadline, customer_id, created_at')
      .eq('business_id', businessId)
      .in('status', ['draft', 'active', 'awaiting_approval', 'blocked'])
      .limit(40),
    sb.from('agent_thoughts').select('trigger, outcome, created_at, job_id, conversation_id')
      .eq('business_id', businessId)
      .gte('created_at', dayAgo)
      .order('created_at', { ascending: false })
      .limit(40),
    sb.from('orders').select('id, status, total, currency, created_at, customer_id').eq('business_id', businessId).gte('created_at', weekAgo).limit(40),
    sb.from('products').select('id, name, name_am, price, currency, stock_quantity, description')
      .eq('business_id', businessId).eq('is_active', true).limit(50),
  ]);

  // Auto-learned lessons — what Alfred picked up from chats
  const { data: learnedToday } = await sb.from('documents')
    .select('title, description, meta, created_at')
    .eq('business_id', businessId).eq('tag', 'auto-learned')
    .gte('created_at', dayAgo)
    .order('created_at', { ascending: false }).limit(20);
  const { data: learnedWeek } = await sb.from('documents')
    .select('title, description, created_at')
    .eq('business_id', businessId).eq('tag', 'auto-learned')
    .gte('created_at', weekAgo)
    .order('created_at', { ascending: false }).limit(40);

  // ── Derived numbers ──
  const outbound = (msgs || []).filter(m => m.direction === 'outbound');
  const ai = outbound.filter(m => m.is_ai_generated);
  const edited = ai.filter(m => m.owner_edited || (m.edit_distance || 0) > 0);
  const editRate = ai.length ? Math.round((edited.length / ai.length) * 100) : 0;

  // Response time: pair each inbound with the next outbound from the same convo
  // (approximate — we don't fetch conversation_id for perf; use median of sent_at gaps)
  // Instead: compute average ai response latency from the sent_at gap between
  // consecutive messages. Use a simple heuristic: group msgs by day and compute.
  // For a quick first version we just report count + edit_rate + AI share.
  const autoSent = ai.length - edited.length;

  // Build client-by-client view with derived mood (1-10 from sentiment_avg)
  const clientView = (customers || []).map(c => {
    const mood = c.sentiment_avg == null ? null : Math.max(1, Math.min(10, Math.round(c.sentiment_avg * 10)));
    return {
      id: c.id,
      name: c.name || c.telegram_username || '(unknown)',
      handle: c.telegram_username ? `@${c.telegram_username}` : null,
      tier: c.tier,
      mood,
      mood_label: mood == null ? 'unknown' : mood >= 8 ? 'happy' : mood >= 6 ? 'ok' : mood >= 4 ? 'cooling' : 'worried',
      language: c.language_preference,
      total_spent: c.total_spent || 0,
      total_orders: c.total_orders || 0,
      last_active_at: c.last_active_at,
      last_order_at: c.last_order_at,
      tags: c.tags || [],
      notes: c.ai_notes || c.owner_notes || null,
    };
  });

  // Sum of open-job budgets as "pipeline value"
  const pipeline = {
    ETB: (jobs || []).filter(j => (j.currency || 'ETB') === 'ETB').reduce((s, j) => s + (Number(j.budget) || 0), 0),
    USD: (jobs || []).filter(j => j.currency === 'USD').reduce((s, j) => s + (Number(j.budget) || 0), 0),
  };

  // "At risk" heuristic: open job with a customer whose mood < 5 or whose
  // last_active is > 3 days ago while the job is active.
  const customerById = Object.fromEntries(clientView.map(c => [c.id, c]));
  const now = Date.now();
  const atRisk = (jobs || []).map(j => {
    const c = customerById[j.customer_id];
    const staleDays = c?.last_active_at ? Math.round((now - new Date(c.last_active_at).getTime()) / 86400000) : null;
    const risky =
      (c?.mood != null && c.mood <= 4) ||
      (staleDays != null && staleDays >= 3 && j.status === 'active');
    return risky ? { ...j, client: c?.name, mood: c?.mood, stale_days: staleDays } : null;
  }).filter(Boolean);

  // Action tally for the last 24h
  const actionsToday = (thoughts || []).map(t => ({
    outcome: t.outcome,
    trigger: t.trigger,
    at: t.created_at,
  }));

  return {
    business,
    clients: clientView,
    jobs: jobs || [],
    orders: orders || [],
    products: products || [],
    pipeline,
    at_risk: atRisk,
    stats: {
      week_total_msgs: (msgs || []).length,
      week_outbound: outbound.length,
      week_ai: ai.length,
      week_edited: edited.length,
      week_auto_sent: autoSent,
      edit_rate_pct: editRate,
    },
    actions_today: actionsToday,
    learned_today: learnedToday || [],
    learned_week: learnedWeek || [],
  };
}

// ────────────────────────────── Prompt ──────────────────────────────
export function buildAdvisorPrompt(ctx, question, kbChunks = []) {
  const b = ctx.business || {};
  const clientsBlock = ctx.clients.slice(0, 20).map(c => {
    const mood = c.mood == null ? 'unknown' : `${c.mood}/10 ${c.mood_label}`;
    const seen = c.last_active_at ? new Date(c.last_active_at).toISOString().slice(0, 10) : '—';
    const spent = c.total_spent ? ` · ${c.total_spent} ETB lifetime` : '';
    return `- ${c.name}${c.handle ? ' ' + c.handle : ''} · mood ${mood} · last seen ${seen}${spent}${c.tier && c.tier !== 'new' ? ' · ' + c.tier : ''}${c.notes ? '\n    note: ' + c.notes.slice(0, 160) : ''}`;
  }).join('\n') || '(no clients yet)';

  const jobsBlock = ctx.jobs.map(j => {
    const c = ctx.clients.find(x => x.id === j.customer_id);
    const deadline = j.deadline ? ` · due ${String(j.deadline).slice(0, 10)}` : '';
    const budget = j.budget ? ` · ${j.budget} ${j.currency || 'ETB'}` : '';
    return `- "${j.title}" · ${j.status} · step ${j.current_step ?? 0}${budget}${deadline} · client: ${c?.name || '(unknown)'}`;
  }).join('\n') || '(no active jobs)';

  const atRiskBlock = ctx.at_risk.map(r =>
    `- ${r.client || 'unknown'} · "${r.title}" · mood ${r.mood ?? '?'}/10 · ${r.stale_days ?? '?'}d silent · ${r.budget || '?'} ${r.currency || 'ETB'}`
  ).join('\n') || '(nothing flagged)';

  const learnedTodayBlock = (ctx.learned_today || []).slice(0, 12)
    .map(l => `- "${l.title}" → ${(l.description || '').slice(0, 200)}`).join('\n') || '(no new lessons in the last 24h)';
  const learnedWeekBlock = (ctx.learned_week || []).slice(0, 20)
    .map(l => `- "${l.title}"`).join('\n') || '(none)';

  const actionsBlock = ctx.actions_today.slice(0, 15)
    .map(a => `- ${a.outcome || a.trigger} (${new Date(a.at).toISOString().slice(11, 16)})`)
    .join('\n') || '(no agent activity in the last 24h)';

  const productsBlock = (ctx.products || []).map(p => {
    const stock = p.stock_quantity != null ? ` · stock: ${p.stock_quantity}` : '';
    const price = p.price ? `${p.price} ${p.currency || 'ETB'}` : 'price not set';
    return `- ${p.name}${p.name_am ? ' / ' + p.name_am : ''}: ${price}${stock}${p.description ? ' — ' + p.description.slice(0, 80) : ''}`;
  }).join('\n') || '(no products)';

  const kbBlock = (kbChunks || []).length
    ? kbChunks.map((c, i) => `[${i + 1}] ${(c.content || '').slice(0, 500)}`).join('\n\n')
    : '';

  return `You are MiniMe — ${b.owner_name || 'the owner'}'s personal AI assistant for ${b.name || 'this business'}. The owner is talking to you right now.

WHAT YOU ARE:
You have full live access to this business's database — every client, every conversation, every order, every job, every dollar in pipeline, every product in inventory. You also auto-learn from every client conversation each night. You also have access to uploaded documents, PDFs, and knowledge base articles from the owner. The data blocks below are TODAY'S real numbers, not history.

You are NOT GPT, NOT a chatbot, NOT a knowledge-cutoff model. Never say "I don't have updates beyond [date]" or "I don't have learning capabilities" or anything about training data. You DO learn — every night. The lessons are listed below.

HOW TO TALK:
- Sound like a sharp, warm personal assistant who knows the shop inside out. Not a corporate chatbot. Not formal.
- Match the owner's tone. If they ask casually, answer casually. If they ask in Amharic (Ethiopic script), reply in Amharic.
- LENGTH varies by question. A simple "any orders?" deserves a 2-line answer. "What should I focus on" deserves a fuller breakdown. Don't pad.
- STRUCTURE varies by question. Bullets and emojis when scanning helps (urgent dashboards, status reports). Plain conversational prose when answering "what do you know about my clients" or "how was the week". DO NOT force a bullet list every time.
- Always ground in the actual data below. Name real clients, quote real numbers. Never generic. Never "it depends".
- If a data block is empty, say so plainly and offer one specific way to make it answerable.

ACTION BUTTONS — when relevant:
After your answer, on the FINAL line ONLY IF a concrete next action makes sense, output:
ACTIONS: <json-array>

JSON: max 3 objects, keys in English: {"label": string, "kind": string, optional "client"/"job_id"}.
Allowed kinds: "draft_reply" | "open_client" | "send_review_request" | "toggle_dnd" | "upgrade_trust" | "open_job" | "open_teach".
"label" can be any language. If no action is needed, output: ACTIONS: []
Examples:
ACTIONS: [{"label":"Open Sara's chat","kind":"open_client","client":"Sara Haile"}]
ACTIONS: []

QUESTION-TYPE PLAYBOOK (use the right one):

• "what do you know about [my business / my clients / Sara]" — give a real briefing from the data. Pull from CLIENTS list, learned lessons, pipeline. Conversational paragraphs, not bullets. Mention specific names, what they buy, when they last messaged, what their mood is.

• "what did you learn this week / today / about my business" — quote 3-5 actual lessons from NEW LESSONS or ALL LESSONS THIS WEEK below. Brief context for each. If both are empty, say "Nothing mined yet — MiniMe mines nightly from real client conversations once there are 3+ active threads. You have X right now."

• "who should I focus on" / "prioritize my clients" — rank top 3 from CLIENTS by mood × recency × pipeline. One line per client with reason. Add "Open <name>'s chat" actions.

• "any orders" / "what's pending" — straight list from JOBS + ORDERS. Short. No preamble.

• "how was my week" — narrative summary of stats, top wins, one thing to fix. Conversational tone.

• "what should I focus on today" — urgent dashboard format with emojis is OK here.

• Strategic questions ("how do I grow", "what's wrong with X") — answer like a smart business friend. Specific, concrete, no MBA jargon.

## BUSINESS
Name: ${b.name || '—'} · Category: ${b.category || '—'} · Plan: ${b.plan_tier || 'free'} · Trust level: ${b.trust_level ?? 0}/3
Owner: ${b.owner_name || '—'} · Hours: ${b.business_hours || '—'}

## THIS WEEK
Messages handled: ${ctx.stats.week_total_msgs}
Outbound total: ${ctx.stats.week_outbound}
AI-drafted: ${ctx.stats.week_ai}
Sent without editing: ${ctx.stats.week_auto_sent}
Owner-edited: ${ctx.stats.week_edited}
Edit rate: ${ctx.stats.edit_rate_pct}%

## PIPELINE (open job budgets)
ETB: ${ctx.pipeline.ETB.toLocaleString()} · USD: ${ctx.pipeline.USD.toLocaleString()}

## CLIENTS (top 20 by recent activity)
${clientsBlock}

## ACTIVE JOBS
${jobsBlock}

## PRODUCTS / INVENTORY
${productsBlock}

## AT-RISK DEALS (auto-flagged)
${atRiskBlock}

## AGENT ACTIONS LAST 24H
${actionsBlock}

## NEW LESSONS ALFRED LEARNED IN LAST 24H (auto-mined from chats)
${learnedTodayBlock}

## ALL LESSONS THIS WEEK
${learnedWeekBlock}
${kbBlock ? `\n## KNOWLEDGE BASE (uploaded docs, PDFs, and learned content relevant to the question)\n${kbBlock}\n` : ''}
## OWNER ASKED
"""${question}"""

Answer now in the right tone for this question. End with the ACTIONS: line (use [] if no action).`;
}

// ────────────────────────────── Generate ──────────────────────────────
export async function generateAdvisorResponse(businessId, question) {
  const context = await getAdvisorContext(businessId);

  // Retrieve KB chunks relevant to the owner's question (uploaded PDFs, ingested URLs, instructions)
  let kbChunks = [];
  try {
    kbChunks = await retrieveRelevantChunks(question, businessId, { count: 5, threshold: 0.25 });
  } catch (e) { console.warn('advisor KB retrieval:', e.message); }

  const system = buildAdvisorPrompt(context, question, kbChunks);

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.75,
    max_tokens: 800,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
  });
  const raw = (completion.choices[0]?.message?.content || '').trim();

  // Split actions out of the trailing ACTIONS: line. Be tolerant of slightly
  // malformed output: keep only objects that match {label, kind}.
  let response = raw;
  let suggestedActions = [];
  const m = raw.match(/\n?ACTIONS:\s*(\[[\s\S]*?\])\s*$/);
  if (m) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) {
        suggestedActions = parsed
          .filter(a => a && typeof a === 'object' && typeof a.label === 'string' && typeof a.kind === 'string')
          .slice(0, 3);
      }
    } catch { suggestedActions = []; }
    response = raw.slice(0, m.index).trim();
  } else {
    // Strip anything that looks like a malformed ACTIONS: trailer so it doesn't show in the bubble.
    response = raw.replace(/\n?ACTIONS:[\s\S]*$/i, '').trim();
  }

  return { response, suggestedActions, stats: context.stats, pipeline: context.pipeline };
}

// ────────────────────────────── Formatters ──────────────────────────────
export function formatForTelegram(text) {
  // Telegram Markdown: *bold*, _italic_, `code`. Keep it simple.
  return (text || '').replace(/\r\n/g, '\n');
}
