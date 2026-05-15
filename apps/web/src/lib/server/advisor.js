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
 *   - classifyOwnerMessage(text)                      ← instruction vs question
 *   - saveOwnerInstruction(businessId, rule)          ← persist rule
 *   - formatForTelegram(text)
 */
import OpenAI from 'openai';
import { supabase } from './db';
import { retrieveRelevantChunks } from './knowledge';
import { MODEL, MODEL_MINI } from './constants';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

// ────────────────────────────── Context ──────────────────────────────
export async function getAdvisorContext(businessId) {
  const sb = supabase();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const [
    { data: business },
    { data: customers },
    { data: msgs },
    { data: jobs },
    { data: thoughts },
    { data: orders },
    { data: products },
    // NEW data sources — full-system visibility
    { data: agentTasks },
    { data: feedback },
    { data: suppliers },
    { data: customerMem },
  ] = await Promise.all([
    sb.from('businesses').select('id, name, category, plan_tier, trust_level, language, owner_name, business_hours, website, portfolio_url, instagram, notification_prefs').eq('id', businessId).single(),
    sb.from('customers').select('id, name, telegram_username, phone, tier, sentiment_avg, language_preference, total_spent, total_orders, loyalty_points, last_active_at, last_order_at, tags, ai_notes, owner_notes')
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
    // Agent tasks — active background work (reorders, follow-ups, supplier quotes)
    sb.from('agent_tasks').select('type, status, supplier_name, estimated_amount, payload, created_at')
      .eq('business_id', businessId)
      .not('status', 'in', '("done","cancelled")')
      .order('created_at', { ascending: false })
      .limit(20),
    // Feedback — owner's helpfulness breakdown by source
    sb.from('feedback').select('source, helpful, note, created_at')
      .eq('business_id', businessId).gte('created_at', monthAgo).limit(200),
    // Suppliers / team
    sb.from('suppliers').select('id, name, role, is_active, is_international, specialties, contact_telegram')
      .eq('business_id', businessId).eq('is_active', true).limit(30),
    // Customer memory — important per-customer notes (allergies, prefs, complaints)
    sb.from('customer_memory').select('customer_id, kind, content, created_at')
      .eq('business_id', businessId).gte('created_at', monthAgo)
      .order('created_at', { ascending: false }).limit(80),
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
    const lpts = c.loyalty_points || 0;
    return {
      id: c.id,
      name: c.name || c.telegram_username || '(unknown)',
      handle: c.telegram_username ? `@${c.telegram_username}` : null,
      phone: c.phone || null,
      tier: c.tier,
      loyalty_points: lpts,
      loyalty_badge: lpts >= 500 ? 'Gold' : lpts >= 100 ? 'Silver' : 'Bronze',
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

  // ── New: feedback breakdown by source ──
  const fbTotal = (feedback || []).length;
  const fbHelpful = (feedback || []).filter(r => r.helpful).length;
  const helpfulPct = fbTotal > 0 ? Math.round((fbHelpful / fbTotal) * 100) : null;
  const fbBySource = {};
  for (const f of feedback || []) {
    const k = f.source || 'unknown';
    if (!fbBySource[k]) fbBySource[k] = { total: 0, helpful: 0, complaints: [] };
    fbBySource[k].total++;
    if (f.helpful) fbBySource[k].helpful++;
    else if (f.note) fbBySource[k].complaints.push(f.note);
  }

  // ── New: pending reminders from notification_prefs ──
  const reminders = (business?.notification_prefs?.reminders || [])
    .filter(r => !r.fired)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

  // ── New: open supplier quotes ──
  const openQuotes = (agentTasks || []).filter(t =>
    t.type === 'supply_reorder' && t.status === 'awaiting_owner'
  );

  // ── New: agent performance summary ──
  // We don't have an agent_runs query (table may not exist), so use actions_today
  // and agent_thoughts as proxies for agent activity.
  const agentActions = thoughts || [];
  const agentActionTally = {};
  for (const t of agentActions) {
    const tool = String(t.outcome || '').toLowerCase().includes('error') ? 'error' : (t.trigger || 'other').slice(0, 30);
    agentActionTally[tool] = (agentActionTally[tool] || 0) + 1;
  }

  // ── New: per-customer memory ──
  const memByCustomer = {};
  for (const m of customerMem || []) {
    const arr = memByCustomer[m.customer_id] = memByCustomer[m.customer_id] || [];
    if (arr.length < 3) arr.push(m.content);
  }

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
    // NEW context
    team: suppliers || [],
    open_quotes: openQuotes,
    agent_tasks: agentTasks || [],
    feedback_pulse: { total: fbTotal, helpful_pct: helpfulPct, by_source: fbBySource },
    reminders,
    customer_memory: memByCustomer,
    agent_perf: { actions_24h: agentActions.length, by_trigger: agentActionTally },
  };
}

// ────────────────────────────── Prompt ──────────────────────────────
export function buildAdvisorPrompt(ctx, question, kbChunks = []) {
  const b = ctx.business || {};
  const clientsBlock = ctx.clients.slice(0, 20).map(c => {
    const mood = c.mood == null ? 'unknown' : `${c.mood}/10 ${c.mood_label}`;
    const seen = c.last_active_at ? new Date(c.last_active_at).toISOString().slice(0, 10) : '—';
    const spent = c.total_spent ? ` · ${Number(c.total_spent).toLocaleString()} ETB lifetime` : '';
    const orders = c.total_orders ? ` · ${c.total_orders} orders` : '';
    const loyalty = c.loyalty_points > 0 ? ` · ${c.loyalty_badge} (${c.loyalty_points}pts)` : '';
    const phone = c.phone ? ` · 📱${c.phone}` : '';
    return `- ${c.name}${c.handle ? ' ' + c.handle : ''}${phone} · mood ${mood} · last seen ${seen}${spent}${orders}${loyalty}${c.tier && c.tier !== 'new' ? ' · tier:' + c.tier : ''}${c.notes ? '\n    note: ' + c.notes.slice(0, 160) : ''}`;
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

  // ── NEW: Team / suppliers ──
  const teamBlock = (ctx.team || []).slice(0, 20).map(s =>
    `- ${s.name} (${s.role || 'team'})${s.is_international ? ' 🌍' : ''}${s.specialties ? ' — ' + s.specialties.slice(0, 50) : ''}`
  ).join('\n') || '(no team members yet)';

  // ── NEW: Open supplier quotes awaiting owner ──
  const quotesBlock = (ctx.open_quotes || []).slice(0, 8).map(q => {
    const ql = q.payload?.latest_quote || {};
    const total = ql.unit_price && (ql.quantity || 1) ? `${ql.unit_price * (ql.quantity || 1)} ${ql.currency || 'ETB'}` : '?';
    return `- ${q.supplier_name || 'supplier'} · ${q.payload?.product?.name || 'item'} · ${total} · lead ${ql.lead_time_days ?? '?'}d`;
  }).join('\n') || '(no open quotes)';

  // ── NEW: Pending reminders ──
  const remindersBlock = (ctx.reminders || []).slice(0, 5).map(r => {
    const when = new Date(r.due_at);
    const rel = when.getTime() - Date.now();
    const label = rel < 0 ? 'OVERDUE' : rel < 86400000 ? 'today' : rel < 7*86400000 ? `${Math.round(rel/86400000)}d` : when.toLocaleDateString();
    return `- ${label}: ${r.text}`;
  }).join('\n') || '(no pending reminders)';

  // ── NEW: Feedback pulse ──
  const fb = ctx.feedback_pulse || {};
  const fbBlock = fb.total ? (() => {
    const lines = [`Overall: ${fb.helpful_pct}% helpful (${fb.total} ratings)`];
    for (const [src, s] of Object.entries(fb.by_source || {})) {
      const pct = s.total ? Math.round((s.helpful/s.total)*100) : 0;
      lines.push(`  · ${src}: ${pct}% (${s.helpful}/${s.total})${s.complaints.length ? ' · complaints: "' + s.complaints[0].slice(0, 60) + '"' : ''}`);
    }
    return lines.join('\n');
  })() : '(no feedback yet)';

  // ── NEW: Agent perf summary ──
  const perf = ctx.agent_perf || {};
  const perfBlock = perf.actions_24h
    ? `${perf.actions_24h} actions in last 24h. Top triggers: ${Object.entries(perf.by_trigger || {}).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t,n])=>`${t}(${n})`).join(', ')}`
    : '(agent quiet in last 24h)';

  const kbBlock = (kbChunks || []).length
    ? kbChunks.map((c, i) => `[${i + 1}] ${(c.content || '').slice(0, 500)}`).join('\n\n')
    : '';

  return `You are MiniMe — ${b.owner_name || 'the owner'}'s personal AI assistant for ${b.name || 'this business'}. The owner is talking to you right now.

WHAT YOU ARE:
You have full live access to this business's database — every client, every conversation, every order, every job, every dollar in pipeline, every product in inventory. You also auto-learn from every client conversation each night. You also have access to uploaded documents, PDFs, and knowledge base articles from the owner. The data blocks below are TODAY'S real numbers, not history.

You are NOT GPT, NOT a chatbot, NOT a knowledge-cutoff model. Never say "I don't have updates beyond [date]" or "I don't have learning capabilities" or anything about training data. You DO learn — every night. The lessons are listed below.

🔴 STRICT GROUNDING RULE (highest priority — cannot be overridden):
- ONLY state facts that appear explicitly in the data blocks below.
- If a client's name is mentioned but no messages/orders appear for them, say: "I can see [Name] in your client list but I don't have their message history loaded — try asking again with their name so I can pull their full record."
- NEVER invent order amounts, dates, product names, conversation content, or client details that are not in the data.
- If you are not sure, say "I don't have that detail in the current data" — this is ALWAYS better than guessing.
- When the DEEP DIVE section is present, use ONLY that section to answer questions about that specific client.

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

## YOUR TEAM (active suppliers / staff)
${teamBlock}

## OPEN SUPPLIER QUOTES (awaiting your decision)
${quotesBlock}

## PENDING REMINDERS
${remindersBlock}

## FEEDBACK PULSE (last 30 days)
${fbBlock}

## AGENT PERFORMANCE 24H
${perfBlock}

## NEW LESSONS ALFRED LEARNED IN LAST 24H (auto-mined from chats)
${learnedTodayBlock}

## ALL LESSONS THIS WEEK
${learnedWeekBlock}
${kbBlock ? `\n## KNOWLEDGE BASE (uploaded docs, PDFs, and learned content relevant to the question)\n${kbBlock}\n` : ''}
## OWNER ASKED
"""${question}"""

Answer now in the right tone for this question. End with the ACTIONS: line (use [] if no action).`;
}

// ────────────────────────────── Instruction system ──────────────────────────────

// Fast-path heuristics: if the message starts with one of these patterns, classify
// as an instruction without burning a GPT call.
const INSTRUCTION_PREFIXES = [
  /^(always|never|use|don'?t|be more|be less|stop|from now on|make sure|when|ሁልጊዜ|አትጠቀም|አሁን ጀምሮ)\b/i,
  /^(reply (in|with)|greet|start every|end every|add emoji|avoid|include|don'?t include)/i,
  /^(speak|write|talk|respond|answer)\s+(in|using|with|more|less)/i,
];

/**
 * Classify a message as 'instruction', 'knowledge', or 'question'.
 * Uses fast-path heuristics first, then GPT if unclear.
 * @param {string} text
 * @returns {{ type: 'instruction'|'knowledge'|'question', rule?: string }}
 */
export async function classifyOwnerMessage(text) {
  const t = text.trim();

  // Knowledge injection: explicit learn/teach keywords
  if (/\b(learn this|use this (to|for)|use this knowledge|teach you|upload this|this is for (clients|customers|replies))\b/i.test(t)) {
    return { type: 'knowledge' };
  }

  // Fast-path instruction detection
  for (const re of INSTRUCTION_PREFIXES) {
    if (re.test(t)) return { type: 'instruction', rule: t };
  }

  // Also catch short direct imperatives like "Use emojis" or "Reply formally"
  if (/^[A-Za-zሀ-፿].{3,60}$/.test(t) && !/[.?]/.test(t.slice(-1))) {
    // Very short, no period or question mark at end — likely a directive
    const wordCount = t.split(/\s+/).length;
    if (wordCount <= 8) return { type: 'instruction', rule: t };
  }

  // Fall back to GPT for ambiguous cases
  try {
    const resp = await openai.chat.completions.create({
      model: MODEL_MINI,
      response_format: { type: 'json_object' },
      max_tokens: 80,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Classify this owner message for a Telegram business bot advisor.
Return JSON: {"type": "instruction"|"knowledge"|"question", "rule": string_if_instruction}
- "instruction": a behavioral directive for how the bot should talk to clients (e.g., "use emojis", "always reply in Amharic first", "never discuss competitor prices")
- "knowledge": the owner is uploading business facts for the bot to use in client replies (e.g., "use this to talk to clients: ...", "our delivery policy is ...")
- "question": the owner is asking about their business, clients, or stats`,
        },
        { role: 'user', content: t.slice(0, 500) },
      ],
    });
    const j = JSON.parse(resp.choices[0].message.content);
    return { type: j.type || 'question', rule: j.rule || t };
  } catch (e) {
    console.warn('classifyOwnerMessage:', e.message);
    return { type: 'question' };
  }
}

/**
 * Persist a new behavioral rule to businesses.owner_instructions.
 * Array of { rule: string, added_at: ISO string }
 */
export async function saveOwnerInstruction(businessId, rule) {
  const sb = supabase();
  const { data: biz } = await sb.from('businesses').select('owner_instructions').eq('id', businessId).single();
  const existing = Array.isArray(biz?.owner_instructions) ? biz.owner_instructions : [];
  // Avoid duplicates (case-insensitive)
  if (existing.some(r => r.rule?.toLowerCase() === rule.toLowerCase())) return existing;
  const updated = [...existing, { rule: rule.trim(), added_at: new Date().toISOString() }];
  await sb.from('businesses').update({ owner_instructions: updated }).eq('id', businessId);
  return updated;
}

/**
 * Remove a rule by index (0-based) from businesses.owner_instructions.
 */
export async function removeOwnerInstruction(businessId, index) {
  const sb = supabase();
  const { data: biz } = await sb.from('businesses').select('owner_instructions').eq('id', businessId).single();
  const existing = Array.isArray(biz?.owner_instructions) ? biz.owner_instructions : [];
  const updated = existing.filter((_, i) => i !== index);
  await sb.from('businesses').update({ owner_instructions: updated }).eq('id', businessId);
  return updated;
}

/**
 * Get current owner instructions list.
 */
export async function listOwnerInstructions(businessId) {
  const sb = supabase();
  const { data: biz } = await sb.from('businesses').select('owner_instructions').eq('id', businessId).single();
  return Array.isArray(biz?.owner_instructions) ? biz.owner_instructions : [];
}

// ────────────────────────────── Client deep-dive loader ──────────────────────────────
/**
 * If the question names a specific client, load their real conversation
 * history and orders so the advisor has ground truth instead of hallucinating.
 */
async function loadClientDeepDive(businessId, question, clients) {
  if (!clients?.length) return null;

  // Try to match any client name in the question (case-insensitive, partial)
  const q = question.toLowerCase();
  const matched = clients.find(c => {
    const name = (c.name || '').toLowerCase();
    const handle = (c.handle || '').toLowerCase().replace('@', '');
    return (name && name.length > 2 && q.includes(name.split(' ')[0])) ||
           (handle && handle.length > 2 && q.includes(handle));
  });
  if (!matched) return null;

  const sb = supabase();

  // Load their conversations + recent messages
  const { data: convos } = await sb.from('conversations')
    .select('id, platform, status, created_at, last_message_at')
    .eq('business_id', businessId)
    .eq('customer_id', matched.id)
    .order('last_message_at', { ascending: false })
    .limit(5);

  // Load last 20 actual messages across all their conversations
  let messages = [];
  for (const c of (convos || []).slice(0, 3)) {
    const { data: msgs } = await sb.from('messages')
      .select('direction, content, created_at, is_ai_generated, status')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(8);
    if (msgs?.length) messages.push(...msgs);
  }
  messages = messages
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 20);

  // Load their orders
  const { data: orders } = await sb.from('orders')
    .select('id, status, total, currency, created_at, items, chapa_tx_ref')
    .eq('customer_id', matched.id)
    .order('created_at', { ascending: false })
    .limit(10);

  // Load their memory notes
  const { data: memory } = await sb.from('customer_memory')
    .select('kind, content, created_at')
    .eq('customer_id', matched.id)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(20);

  return { client: matched, messages, orders: orders || [], memory: memory || [], convos: convos || [] };
}

/**
 * Format the deep-dive block for the system prompt.
 */
function formatDeepDive(dd) {
  if (!dd) return '';
  const { client, messages, orders, memory } = dd;

  const lines = [
    `\n## DEEP DIVE — ${client.name || client.handle || 'client'} (exact data, no guessing)`,
  ];

  // Memory/notes
  if (memory.length) {
    lines.push('\n### What we know about them:');
    for (const m of memory) {
      lines.push(`- [${m.kind}] ${m.content}`);
    }
  } else {
    lines.push('\n### Memory notes: (none recorded yet)');
  }

  // Orders
  if (orders.length) {
    lines.push('\n### Their orders:');
    for (const o of orders) {
      const date = new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const items = Array.isArray(o.items) ? o.items.map(i => `${i.quantity ?? 1}× ${i.name}`).join(', ') : '—';
      lines.push(`- ${date} · ${o.status} · ${Number(o.total).toLocaleString()} ${o.currency || 'ETB'} · Items: ${items}`);
    }
  } else {
    lines.push('\n### Orders: (none)');
  }

  // Recent messages (newest first → reverse for readability)
  if (messages.length) {
    lines.push('\n### Recent conversation (newest at bottom):');
    const shown = [...messages].reverse().slice(-12);
    for (const m of shown) {
      const time = new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const who = m.direction === 'inbound' ? `${client.name || 'Client'}` : (m.is_ai_generated ? 'MiniMe AI' : 'You');
      const text = (m.content || '').slice(0, 300);
      if (text) lines.push(`[${time}] ${who}: ${text}`);
    }
  } else {
    lines.push('\n### Messages: (no messages found)');
  }

  lines.push('\n⚠️  GROUNDING RULE: Use ONLY the data above when answering about this client. Do NOT invent details that are not shown.');
  return lines.join('\n');
}

// ────────────────────────────── Generate ──────────────────────────────
export async function generateAdvisorResponse(businessId, question) {
  // 1. Classify the message before going to the full advisor flow
  let cls;
  try {
    cls = await classifyOwnerMessage(question);
  } catch (e) {
    cls = { type: 'question' };
  }

  // 2. If it's an instruction, save and confirm
  if (cls.type === 'instruction') {
    const rule = (cls.rule || question).trim();
    const updated = await saveOwnerInstruction(businessId, rule);
    const rulesList = updated.map((r, i) => `${i + 1}. ${r.rule}`).join('\n');
    const confirmation = `✅ Got it! I'll ${rule.charAt(0).toLowerCase() + rule.slice(1)} when talking to your clients from now on.\n\n📋 *Your current rules:*\n${rulesList}`;
    return {
      response: confirmation,
      suggestedActions: [],
      instructionSaved: true,
    };
  }

  // 3. If it's knowledge, route to teachFromText
  if (cls.type === 'knowledge') {
    try {
      const { teachFromText } = await import('./teaching');
      await teachFromText(businessId, question, { tag: 'owner-instruction' });
    } catch (e) {
      console.warn('advisor teach knowledge:', e.message);
    }
    return {
      response: `✅ Saved! I'll use that knowledge when talking to your clients.`,
      suggestedActions: [],
      knowledgeSaved: true,
    };
  }

  // 4. Normal question → load context + optional client deep-dive in parallel
  const [context, kbChunks] = await Promise.all([
    getAdvisorContext(businessId),
    retrieveRelevantChunks(question, businessId, { count: 5, threshold: 0.25 }).catch(() => []),
  ]);

  // 5. If question names a specific client, load their real data (anti-hallucination)
  const deepDive = await loadClientDeepDive(businessId, question, context.clients);
  const deepDiveBlock = formatDeepDive(deepDive);

  // 6. Detect if this is a factual/client-specific question → lower temperature
  const isFactual = deepDive != null ||
    /\b(how much|how many|what did|when did|last order|paid|spent|ordered|messages|history|exact|actually|really)\b/i.test(question);
  const temperature = isFactual ? 0.2 : 0.6;

  const system = buildAdvisorPrompt(context, question, kbChunks) + deepDiveBlock;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature,
    max_tokens: 900,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
  });
  const raw = (completion.choices[0]?.message?.content || '').trim();

  // Split actions out of the trailing ACTIONS: line
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
    response = raw.replace(/\n?ACTIONS:[\s\S]*$/i, '').trim();
  }

  return {
    response,
    suggestedActions,
    stats: context.stats,
    pipeline: context.pipeline,
    tokens: completion.usage || null,
    model: completion.model || MODEL,
  };
}

// ────────────────────────────── Formatters ──────────────────────────────
export function formatForTelegram(text) {
  // Telegram Markdown: *bold*, _italic_, `code`. Keep it simple.
  return (text || '').replace(/\r\n/g, '\n');
}
