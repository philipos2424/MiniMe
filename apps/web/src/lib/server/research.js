/**
 * Research Agent — owner says "find me the best X", we contact multiple
 * MiniMe businesses, collect responses, synthesize, and recommend.
 *
 * Rides entirely on top of b2b.js: each inquiry is a normal B2B message
 * tagged with a campaign_id so we can group the replies.
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { decrypt } from './crypto';
import { parseBudget } from './searchBot.js';
import {
  sendBusinessMessage,
  searchBusinessesByCategory,
  getBusinessesByIds,
  findBusinessByUsername,
} from './b2b';

const MAX_TARGETS = 10;
const DEFAULT_TARGETS = 5;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || 'https://web-theta-one-68.vercel.app';

// ──────────────────────────────────────────────────────────────────────────────
//  startCampaign
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Kick off a research campaign on behalf of the owner.
 *
 * @returns {Promise<{
 *   ok: boolean, campaign_id?: string, contacted?: number,
 *   web_drafts?: number, error?: string, message?: string,
 * }>}
 */
export async function startCampaign({
  business,                 // full businesses row of the SEARCHER
  ownerTgId,
  query,
  category,
  budget,
  maxTargets = DEFAULT_TARGETS,
  questions,                // optional override; otherwise AI generates
}) {
  if (!business?.id) return { ok: false, error: 'invalid_business' };
  if (!query?.trim())  return { ok: false, error: 'empty_query' };
  maxTargets = Math.max(1, Math.min(MAX_TARGETS, Number(maxTargets) || DEFAULT_TARGETS));

  // 0. Parse budget from query text if not provided as structured object
  // Handles "50k", "under 100000", "50000-100000", etc.
  if (!budget || !budget.max) {
    const parsed = parseBudget(query);
    if (parsed && (parsed.max || parsed.min)) {
      budget = { ...budget, ...parsed, currency: budget?.currency || 'ETB' };
    }
  }

  // 0b. Auto-default budget from owner's history if still not provided
  let budgetWasInferred = false;
  if ((!budget || !budget.max) && category) {
    try {
      const { medianBudgetForCategory } = await import('./ownerMemory');
      const median = await medianBudgetForCategory(business.id, category);
      if (median && median > 0) {
        budget = { max: Math.round(median), currency: business.currency || 'ETB', notes: 'inferred from past deals' };
        budgetWasInferred = true;
      }
    } catch (e) { console.warn('[research budget inference]', e.message); }
  }

  // 1. Generate questions if owner didn't provide them
  let qList = Array.isArray(questions) && questions.length
    ? questions.map(q => String(q).slice(0, 300)).slice(0, 6)
    : await aiGenerateQuestions({ query, category, budget });
  if (!qList.length) qList = ['Tell me what you offer for this and your price.'];

  // 2. Find MiniMe candidates — first try resolving "my X" partner references,
  // then add generic category matches up to the cap.
  const resolved = await resolvePartnerReference(business.id, query);
  const remainingSlots = Math.max(0, maxTargets - resolved.length);
  const generic = remainingSlots > 0
    ? await searchBusinessesByCategory(query, { category, limit: remainingSlots, excludeId: business.id })
    : [];
  const seen = new Set(resolved.map(r => r.id));
  const candidates = [
    ...resolved,
    ...generic.filter(g => !seen.has(g.id)),
  ].slice(0, maxTargets);

  // Web fallback disabled — search is MiniMe-only.
  // Non-MiniMe discovery can be re-enabled here when the network is larger.
  const webCandidates = [];

  // 4. Insert the campaign row first (so we have the id for tagging messages)
  const sb = supabase();
  const { data: campaign, error: insertErr } = await sb
    .from('research_campaigns')
    .insert({
      business_id:    business.id,
      owner_tg_id:    ownerTgId,
      query:          query.trim().slice(0, 500),
      category:       category || null,
      questions:      qList,
      budget:         budget || {},
      target_ids:     candidates.map(c => c.id),
      web_candidates: webCandidates,
      thread_ids:     [],
      status:         'open',
      expires_at:     new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h default
    })
    .select()
    .single();

  if (insertErr || !campaign) {
    console.error('[research] insert error:', insertErr?.message);
    return { ok: false, error: 'db_error' };
  }

  // 5. Send the inquiry to each MiniMe candidate (in parallel)
  const inquiryText = formatInquiryMessage({ query, questions: qList, budget, fromBiz: business });
  const threadIds = [];
  await Promise.all(candidates.map(async (target) => {
    try {
      const res = await sendBusinessMessage({
        senderBiz:    business,
        recipientBiz: target,
        initiatedBy:  ownerTgId,
        intent:       'inquiry',
        content:      inquiryText,
        structured:   { campaign_id: campaign.id, query, questions: qList, budget },
      });
      if (res.ok && res.message?.id) {
        // Tag the message with the campaign for reply-tracking
        await sb.from('business_messages')
          .update({ campaign_id: campaign.id })
          .eq('id', res.message.id);
        threadIds.push(res.threadId);
      }
    } catch (e) { console.warn('[research] send to', target.id, e.message); }
  }));

  // 6. Update campaign with actual thread_ids
  if (threadIds.length) {
    await sb.from('research_campaigns')
      .update({ thread_ids: threadIds })
      .eq('id', campaign.id);
  }

  return {
    ok: true,
    campaign_id: campaign.id,
    contacted: candidates.length,
    web_drafts: webCandidates.length,
    budget_inferred: budgetWasInferred ? budget : null,
    candidates: candidates.map(c => ({ id: c.id, name: c.name, username: c.telegram_bot_username })),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  Reply-driven progression
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Called from b2b.recordReply whenever a reply lands on a campaign-tagged
 * thread. Bumps reply_count, fires interim DM, and may trigger synthesis.
 */
export async function processReplyForCampaign({ replyRow, originalRow, campaignId }) {
  const sb = supabase();
  const { data: campaign } = await sb
    .from('research_campaigns').select('*').eq('id', campaignId).maybeSingle();
  if (!campaign || campaign.status !== 'open') return;

  const newCount = (campaign.reply_count || 0) + 1;
  const total = (campaign.target_ids || []).length;
  const updates = { reply_count: newCount };

  // Interim DM at 50%
  const halfway = Math.ceil(total / 2);
  if (newCount >= halfway && !campaign.interim_sent_at && newCount < total) {
    updates.interim_sent_at = new Date().toISOString();
    sendInterimReport({ campaign, newCount, total }).catch(e => console.warn('[interim]', e.message));
  }

  const { error: upErr } = await sb.from('research_campaigns').update(updates).eq('id', campaignId);
  if (upErr) {
    console.error('[research] update campaign', campaignId, upErr.message);
    return;
  }

  // Synthesize when complete
  if (newCount >= total) {
    await synthesizeAndDeliver(campaignId).catch(e => console.warn('[synth]', e.message));
  }
}

/**
 * Mark campaign as reporting → run AI synthesis → send report → mark complete.
 * Safe to call when partial (timeout path).
 */
export async function synthesizeAndDeliver(campaignId) {
  const sb = supabase();
  // Atomically claim
  const { data: campaign } = await sb
    .from('research_campaigns').select('*').eq('id', campaignId).maybeSingle();
  if (!campaign) return { ok: false, error: 'not_found' };
  if (['complete','cancelled'].includes(campaign.status)) return { ok: true, alreadyDone: true };

  await sb.from('research_campaigns')
    .update({ status: 'reporting' })
    .eq('id', campaignId);

  // Gather replies — find all messages on these threads where sender is one of the targets
  let msgs;
  try {
    const { data, error } = await sb
      .from('business_messages')
      .select('id, thread_id, sender_id, content, offer_data, structured, created_at, ai_drafted')
      .in('thread_id', campaign.thread_ids || [])
      .in('sender_id', campaign.target_ids || [])
      .order('created_at', { ascending: true });
    if (error) throw error;
    msgs = data;
  } catch (e) {
    // Fallback without negotiation columns (migration may not have run)
    console.warn('[research] offer_data query failed, retrying without:', e.message);
    const { data } = await sb
      .from('business_messages')
      .select('id, thread_id, sender_id, content, structured, created_at')
      .in('thread_id', campaign.thread_ids || [])
      .in('sender_id', campaign.target_ids || [])
      .order('created_at', { ascending: true });
    msgs = data;
  }

  // Group by sender
  const bySender = {};
  for (const m of msgs || []) {
    if (!bySender[m.sender_id]) bySender[m.sender_id] = [];
    bySender[m.sender_id].push(m);
  }

  const targets = await getBusinessesByIds(campaign.target_ids || []);
  const responseBundles = targets.map(t => ({
    id: t.id,
    name: t.name,
    username: t.telegram_bot_username,
    description: t.description,
    category: t.category,
    messages: bySender[t.id] || [],
  }));

  // Run AI synthesis
  const report = await aiSynthesize({
    query: campaign.query,
    category: campaign.category,
    budget: campaign.budget,
    questions: campaign.questions || [],
    responses: responseBundles,
  });

  await sb.from('research_campaigns').update({
    status: 'complete',
    report,
    completed_at: new Date().toISOString(),
  }).eq('id', campaignId);

  // Deliver
  await deliverReport({ campaign: { ...campaign, report }, responses: responseBundles });
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────────
//  AI helpers
// ──────────────────────────────────────────────────────────────────────────────

async function aiGenerateQuestions({ query, category, budget }) {
  try {
    const { makeOpenAI } = await import('./openaiClient');
    const oa = makeOpenAI();
    const r = await oa.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `A business owner wants to research: "${query}"${category ? ` (category: ${category})` : ''}${budget?.max ? ` (budget around ${budget.max} ${budget.currency || 'ETB'})` : ''}.

Generate 3-5 short, specific questions to ask each candidate business so we can compare them later. Cover: price/cost, lead time, what's included, terms or guarantees, anything category-specific.

Return JSON: { "questions": ["...", "...", "..."] }`,
      }],
    });
    const raw = r.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw || '{}');
    return Array.isArray(parsed.questions) ? parsed.questions.slice(0, 5) : [];
  } catch (e) {
    console.warn('[research aiGenerateQuestions]', e.message);
    return [];
  }
}

async function aiSynthesize({ query, category, budget, questions, responses }) {
  try {
    const { makeOpenAI } = await import('./openaiClient');
    const oa = makeOpenAI();

    const responsesText = responses.map((r, i) => {
      const msgsTxt = (r.messages || []).map(m => `  • ${m.content}`).join('\n') || '  (no reply yet)';
      return `[${i+1}] ${r.name} (@${r.username || 'no-handle'})${r.category ? ' — ' + r.category : ''}${r.description ? '\n   Description: ' + r.description.slice(0, 300) : ''}\nReplies:\n${msgsTxt}`;
    }).join('\n\n');

    const r = await oa.chat.completions.create({
      model: 'gpt-4.1',
      temperature: 0.15,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `You are a senior business advisor helping an Ethiopian SMB owner make a strategic supplier/partner decision. Be thorough, specific, and actionable.

THE OWNER'S REQUEST: "${query}"
${category ? `CATEGORY: ${category}\n` : ''}${budget?.max ? `BUDGET: up to ${budget.max.toLocaleString()} ${budget.currency || 'ETB'}\n` : ''}
QUESTIONS ASKED:
${(questions || []).map((q, i) => `${i+1}. ${q}`).join('\n')}

RESPONSES RECEIVED FROM CANDIDATES:
${responsesText}

INSTRUCTIONS:
1. For EACH candidate, provide deep analysis: price breakdown, lead time, scope/inclusions, payment terms, guarantees, hidden costs, risks.
2. Score 1-10 on: Value (price vs scope), Speed (lead time), Reliability (verified, responsiveness), Fit (category match), Terms (fairness).
3. Identify RED FLAGS (vague pricing, no timeline, no portfolio, unresponsive, unrealistic promises).
4. Identify GREEN FLAGS (clear breakdown, references, warranty, proactive communication, certified).
5. Give a DETAILED recommendation with WHY — not just "best value" but specific reasoning: cost breakdown, risk mitigation, strategic fit.
6. Provide NEGOTIATION LEVERS for the winner (what to push on, what to concede).
7. Provide NEXT STEPS checklist (contract, deposit, milestones, acceptance criteria).

Return JSON (no markdown):
{
  "comparison": [
    {
      "candidate_id": "<id>",
      "name": "...",
      "username": "...",
      "price": "exact amount or range ETB",
      "price_breakdown": "itemized if provided",
      "lead_time": "specific days/weeks",
      "included": "detailed scope",
      "excluded": "what's NOT included (critical!)",
      "payment_terms": "deposit %, milestones, balance on delivery",
      "guarantees": "revisions, warranty, refund policy",
      "pros": ["specific strength 1", "specific strength 2"],
      "cons": ["specific weakness 1", "specific weakness 2"],
      "red_flags": ["vague pricing", "no portfolio", "..."],
      "green_flags": ["clear timeline", "references provided", "..."],
      "responded": true,
      "scores": { "value": 8, "speed": 7, "reliability": 9, "fit": 8, "terms": 7 },
      "overall_score": 7.8
    }
  ],
  "recommendation": {
    "winner_id": "...",
    "winner_name": "...",
    "winner_username": "...",
    "why": "Detailed 3-4 sentence justification: cost advantage, risk profile, strategic fit, specific differentiators",
    "negotiation_levers": ["Push for X", "Concede on Y", "Add clause Z"],
    "next_step_suggestion": "negotiate|order|chat|none",
    "acceptance_criteria": ["Milestone 1: ...", "Milestone 2: ..."]
  },
  "market_context": "1-2 sentences on market rate, typical lead times, common pitfalls in this category",
  "summary_line": "One-sentence executive takeaway for quick reading"
}`,
      }],
    });
    const raw = r.choices?.[0]?.message?.content;
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.warn('[research aiSynthesize]', e.message);
    return { error: 'synthesis_failed', summary_line: 'Could not generate report.' };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Delivery — DM the report to the owner
// ──────────────────────────────────────────────────────────────────────────────

async function deliverReport({ campaign, responses }) {
  const sb = supabase();
  const { data: biz } = await sb.from('businesses')
    .select('telegram_bot_token_enc, owner_telegram_id, owner_private_chat_id, name')
    .eq('id', campaign.business_id).maybeSingle();
  if (!biz?.telegram_bot_token_enc) return;
  let token;
  try { token = decrypt(biz.telegram_bot_token_enc); } catch { return; }
  const chat = biz.owner_private_chat_id || biz.owner_telegram_id;
  if (!token || !chat) return;

  const report = campaign.report || {};
  const responded = (report.comparison || []).filter(c => c.responded).length;
  const total = (campaign.target_ids || []).length;

  const lines = [
    `📊 *Research Complete*`,
    `_\"${escapeMd(campaign.query)}\"_`,
    '',
    `Replies: *${responded}/${total}*`,
    '',
  ];

  if (report.market_context) {
    lines.push(`📈 *Market Context:* ${escapeMd(report.market_context)}`);
    lines.push('');
  }

  // Detailed comparison for each candidate
  for (const c of report.comparison || []) {
    const tag = c.responded ? `🟢` : `⚪`;
    const score = c.overall_score ? ` · ${c.overall_score}/10` : (c.score ? ` · score ${c.score}/10` : '');
    lines.push(`${tag} *${escapeMd(c.name || 'Unknown')}*${score}${c.username ? ` (@${c.username})` : ''}`);
    
    if (c.price) lines.push(`   💰 *Price:* ${escapeMd(String(c.price))}`);
    if (c.price_breakdown) lines.push(`   🔍 *Breakdown:* ${escapeMd(String(c.price_breakdown))}`);
    if (c.lead_time) lines.push(`   ⏱ *Lead Time:* ${escapeMd(String(c.lead_time))}`);
    if (c.included) lines.push(`   ✅ *Included:* ${escapeMd(String(c.included))}`);
    if (c.excluded) lines.push(`   ❌ *Excluded:* ${escapeMd(String(c.excluded))}`);
    if (c.payment_terms) lines.push(`   💳 *Payment:* ${escapeMd(String(c.payment_terms))}`);
    if (c.guarantees) lines.push(`   🛡 *Guarantees:* ${escapeMd(String(c.guarantees))}`);
    
    if (c.pros?.length) lines.push(`   🟢 *Strengths:* ${c.pros.map(p => escapeMd(p)).join(', ')}`);
    if (c.cons?.length) lines.push(`   🔴 *Concerns:* ${c.cons.map(p => escapeMd(p)).join(', ')}`);
    if (c.red_flags?.length) lines.push(`   🚩 *Red Flags:* ${c.red_flags.map(p => escapeMd(p)).join(', ')}`);
    if (c.green_flags?.length) lines.push(`   🟢 *Green Flags:* ${c.green_flags.map(p => escapeMd(p)).join(', ')}`);
    
    if (c.scores) {
      const s = c.scores;
      lines.push(`   📊 *Scores:* Value ${s.value||'-'}/10 · Speed ${s.speed||'-'}/10 · Reliability ${s.reliability||'-'}/10 · Fit ${s.fit||'-'}/10 · Terms ${s.terms||'-'}/10`);
    }
    
    if (!c.responded) lines.push(`   _(no reply received)_`);
    lines.push('');
  }

  if (report.recommendation?.winner_name) {
    lines.push(`🏆 *RECOMMENDATION: ${escapeMd(report.recommendation.winner_name)}*${report.recommendation.winner_username ? ` (@${escapeMd(report.recommendation.winner_username)})` : ''}`);
    if (report.recommendation.why) lines.push(`_${escapeMd(report.recommendation.why)}_`);
    lines.push('');
    
    if (report.recommendation.negotiation_levers?.length) {
      lines.push(`🤝 *Negotiation Levers:*`);
      for (const lever of report.recommendation.negotiation_levers) {
        lines.push(`   • ${escapeMd(lever)}`);
      }
      lines.push('');
    }
    
    if (report.recommendation.acceptance_criteria?.length) {
      lines.push(`✅ *Acceptance Criteria:*`);
      for (const crit of report.recommendation.acceptance_criteria) {
        lines.push(`   • ${escapeMd(crit)}`);
      }
      lines.push('');
    }
    
    lines.push(`👉 *Next Step:* ${report.recommendation.next_step_suggestion || 'negotiate'}`);
  }

  if (report.summary_line) {
    lines.push('', `💡 *Executive Summary:* ${escapeMd(report.summary_line)}`);
  }

  const inlineKb = [];
  if (report.recommendation?.winner_username) {
    inlineKb.push([
      { text: `🤝 Connect with @${report.recommendation.winner_username}`, callback_data: `b2b:connect:${campaign.id}:${report.recommendation.winner_username}` },
    ]);
  }
  inlineKb.push([
    { text: '📊 Full Report in Dashboard', web_app: { url: `${APP_URL}/b2b?tab=research&id=${campaign.id}` } },
  ]);

  // Send in chunks if too long (Telegram 4096 char limit)
  const fullText = lines.join('\n');
  const chunks = [];
  let currentChunk = '';
  for (const line of lines) {
    if ((currentChunk + line + '\n').length > 3800) {
      chunks.push(currentChunk);
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  for (let i = 0; i < chunks.length; i++) {
    await tg(token, 'sendMessage', {
      chat_id: chat,
      text: chunks[i],
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: i === chunks.length - 1 ? { inline_keyboard: inlineKb } : undefined,
    });
  }
}

async function sendInterimReport({ campaign, newCount, total }) {
  const sb = supabase();
  const { data: biz } = await sb.from('businesses')
    .select('telegram_bot_token_enc, owner_telegram_id, owner_private_chat_id')
    .eq('id', campaign.business_id).maybeSingle();
  if (!biz?.telegram_bot_token_enc) return;
  let token;
  try { token = decrypt(biz.telegram_bot_token_enc); } catch { return; }
  const chat = biz.owner_private_chat_id || biz.owner_telegram_id;
  if (!token || !chat) return;

  await tg(token, 'sendMessage', {
    chat_id: chat, parse_mode: 'Markdown',
    text: `📥 *Research update*\n\n_"${escapeMd(campaign.query)}"_\n\nGot ${newCount}/${total} replies so far. I'll send the full comparison once everyone's in (or after 24h).`,
    reply_markup: { inline_keyboard: [[
      { text: '👀 See replies so far', web_app: { url: `${APP_URL}/b2b?tab=research&id=${campaign.id}` } },
    ]] },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  Misc
// ──────────────────────────────────────────────────────────────────────────────

export async function getCampaign(campaignId, viewerBizId) {
  const sb = supabase();
  const { data: campaign } = await sb
    .from('research_campaigns').select('*').eq('id', campaignId).maybeSingle();
  if (!campaign || campaign.business_id !== viewerBizId) return null;
  return campaign;
}

export async function listCampaigns(businessId, { limit = 30 } = {}) {
  const sb = supabase();
  const { data } = await sb
    .from('research_campaigns').select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function cancelCampaign(campaignId, viewerBizId) {
  const sb = supabase();
  const { data: c } = await sb.from('research_campaigns').select('business_id').eq('id', campaignId).maybeSingle();
  if (!c || c.business_id !== viewerBizId) return { ok: false, error: 'not_found' };
  await sb.from('research_campaigns')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', campaignId);
  return { ok: true };
}

/**
 * Format the inquiry message we send to each target business.
 */
function formatInquiryMessage({ query, questions, budget, fromBiz }) {
  const lines = [
    `Hi! ${fromBiz.name || 'A business'} on MiniMe is researching options and would love your input:`,
    '',
    `*Looking for:* ${query}`,
  ];
  if (budget?.max) lines.push(`*Budget:* up to ${budget.max} ${budget.currency || 'ETB'}`);
  if (questions?.length) {
    lines.push('', '*Questions:*');
    for (const q of questions) lines.push(`• ${q}`);
  }
  lines.push('', '_Reply with your offer, or tap "Let MiniMe answer" if you want your Alfred to draft a response._');
  return lines.join('\n');
}

/* ──────────── helpers ──────────── */

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeMd(s) {
  if (!s) return '';
  return String(s).replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
}

/**
 * Resolve "my designer", "my printer", etc. from past B2B threads + owner memory.
 * Returns array of business rows (with discoverable + reachable filter applied).
 */
async function resolvePartnerReference(ownerBizId, query) {
  const sb = supabase();
  const ql = String(query || '').toLowerCase();

  // Role keywords → canonical role names
  const roleKeywords = {
    designer:    ['designer', 'design', 'logo', 'brand', 'branding', 'graphic'],
    printer:     ['printer', 'print', 'printing', 'signage', 'banner', 'flyer'],
    delivery:    ['delivery', 'courier', 'ship', 'logistics', 'transport'],
    supplier:    ['supplier', 'vendor', 'wholesale', 'distributor', 'source'],
    photographer:['photographer', 'photo', 'pictures', 'images'],
    marketer:    ['marketer', 'marketing', 'ads', 'advertising', 'seo', 'social media'],
    developer:   ['developer', 'dev', 'programmer', 'software', 'app', 'website', 'web'],
    accountant:  ['accountant', 'accounting', 'bookkeeper', 'tax', 'finance'],
    lawyer:      ['lawyer', 'legal', 'attorney', 'contract'],
  };

  // Detect role from query
  let detectedRole = null;
  for (const [role, keywords] of Object.entries(roleKeywords)) {
    if (keywords.some(k => ql.includes(k))) {
      detectedRole = role;
      break;
    }
  }

  // If no role detected, also check for "my X" pattern
  const myMatch = ql.match(/my\s+(\w+)/);
  if (!detectedRole && myMatch) {
    const roleGuess = myMatch[1];
    for (const [role, keywords] of Object.entries(roleKeywords)) {
      if (keywords.includes(roleGuess) || role.startsWith(roleGuess) || roleGuess.startsWith(role)) {
        detectedRole = role;
        break;
      }
    }
  }

  if (!detectedRole) return [];

  // Look up past B2B threads where this business was the sender/recipient
  const { data: pastThreads } = await sb
    .from('business_messages')
    .select('sender_id, recipient_id')
    .or(`sender_id.eq.${ownerBizId},recipient_id.eq.${ownerBizId}`)
    .limit(50);

  const partnerIds = new Set();
  for (const t of pastThreads || []) {
    const pid = t.sender_id === ownerBizId ? t.recipient_id : t.sender_id;
    if (pid) partnerIds.add(pid);
  }

  if (!partnerIds.size) return [];

  // Fetch those businesses — include both dedicated-bot and shared-bot (shop_code) tenants
  const { data: partners } = await sb
    .from('businesses')
    .select('id, name, telegram_bot_username, telegram_bot_token_enc, owner_private_chat_id, shop_code, onboarding_completed, category, tags, description')
    .in('id', [...partnerIds])
    .eq('b2b_discoverable', true);

  if (!partners?.length) return [];

  // Filter: reachable = has bot token OR (has shop_code AND onboarding completed)
  // This mirrors resolveToken() in sendAs.js — shared-bot tenants qualify too
  const reachable = partners.filter(p => 
    p.telegram_bot_token_enc || (p.shop_code && p.onboarding_completed)
  );

  // Filter by role match in category/tags/description
  const roleKeywordsLower = roleKeywords[detectedRole];
  return reachable.filter(p => {
    const text = [p.category, ...(p.tags || []), p.description].filter(Boolean).join(' ').toLowerCase();
    return roleKeywordsLower.some(k => text.includes(k));
  });
}

/**
 * Find distinct business_ids whose active product catalog genuinely matches
 * the free-text query (word-boundary + plural-aware, not raw substring —
 * mirrors searchBot.js's product retrieval pool).
 */
async function findBusinessIdsByProductMatch(sb, query) {
  const { singularize, wordMatch } = await import('./searchRanker.mjs');
  const kws = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(w => singularize(w.replace(/[^\p{L}\p{N}]/gu, '')))
    .filter(w => w.length > 2);
  if (!kws.length) return new Set();

  const orFilter = kws.map(k => {
    const kk = k.replace(/[%_,()]/g, ' ').trim();
    return `name.ilike.%${kk}%,description.ilike.%${kk}%,name_am.ilike.%${kk}%,description_am.ilike.%${kk}%,image_tags.ilike.%${kk}%`;
  }).join(',');

  const { data: hits, error } = await sb
    .from('products')
    .select('business_id, name, name_am, description, description_am, image_tags')
    .eq('is_active', true)
    .or(orFilter)
    .limit(30);
  if (error || !hits) return new Set();

  const ids = new Set();
  for (const p of hits) {
    const text = [p.name, p.name_am, p.description, p.description_am, p.image_tags].filter(Boolean);
    const genuine = kws.some(kw => text.some(t => wordMatch(t, kw)));
    if (genuine) ids.add(p.business_id);
  }
  return ids;
}

/* ──────────── helpers ──────────── */

