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

  // 1. Generate questions if owner didn't provide them
  let qList = Array.isArray(questions) && questions.length
    ? questions.map(q => String(q).slice(0, 300)).slice(0, 6)
    : await aiGenerateQuestions({ query, category, budget });
  if (!qList.length) qList = ['Tell me what you offer for this and your price.'];

  // 2. Find MiniMe candidates
  const candidates = await searchBusinessesByCategory(query, {
    category, limit: maxTargets, excludeId: business.id,
  });

  // 3. If too few hits, fetch web candidates
  let webCandidates = [];
  if (candidates.length < 3) {
    try {
      webCandidates = await webSearchFallback(query);
    } catch (e) { console.warn('[research] web fallback failed:', e.message); }
  }

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

  await sb.from('research_campaigns').update(updates).eq('id', campaignId);

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
  const { data: msgs } = await sb
    .from('business_messages')
    .select('id, thread_id, sender_id, content, offer_data, structured, created_at, ai_drafted')
    .in('thread_id', campaign.thread_ids || [])
    .in('sender_id', campaign.target_ids || [])
    .order('created_at', { ascending: true });

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
    const OpenAI = (await import('openai')).default;
    const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
    const OpenAI = (await import('openai')).default;
    const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const responsesText = responses.map((r, i) => {
      const msgsTxt = (r.messages || []).map(m => `  • ${m.content}`).join('\n') || '  (no reply yet)';
      return `[${i+1}] ${r.name} (@${r.username || 'no-handle'})${r.category ? ' — ' + r.category : ''}\nReplies:\n${msgsTxt}`;
    }).join('\n\n');

    const r = await oa.chat.completions.create({
      model: 'gpt-4.1',
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `You are a business research analyst helping an owner pick the best supplier/partner.

THE OWNER ASKED: "${query}"
${category ? `CATEGORY: ${category}\n` : ''}${budget?.max ? `BUDGET: up to ${budget.max} ${budget.currency || 'ETB'}\n` : ''}
QUESTIONS ASKED:
${(questions || []).map((q, i) => `${i+1}. ${q}`).join('\n')}

RESPONSES RECEIVED:
${responsesText}

Compare the candidates. For each, extract price (if mentioned), lead time, what's included, notable terms. Score 1-10 considering quality, price, fit, responsiveness. Recommend ONE winner with a 1-2 sentence justification. If a candidate didn't reply, mark their data null but still include them.

Return JSON (no markdown):
{
  "comparison": [
    {
      "candidate_id": "<the id from the input>",
      "name": "...",
      "username": "...",
      "price": "...",
      "lead_time": "...",
      "included": "...",
      "terms": "...",
      "pros": ["...", "..."],
      "cons": ["...", "..."],
      "responded": true,
      "score": 7
    }
  ],
  "recommendation": {
    "winner_id": "...",
    "winner_name": "...",
    "winner_username": "...",
    "why": "...",
    "next_step_suggestion": "negotiate|order|chat|none"
  },
  "summary_line": "One-sentence top-level takeaway."
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
    `📊 *Research complete*`,
    `_"${escapeMd(campaign.query)}"_`,
    '',
    `Replies: *${responded}/${total}*${report.summary_line ? `\n\n${escapeMd(report.summary_line)}` : ''}`,
    '',
  ];

  // Compact comparison
  for (const c of report.comparison || []) {
    const tag = c.responded ? `🟢` : `⚪`;
    const score = c.score ? ` · score ${c.score}/10` : '';
    lines.push(`${tag} *${escapeMd(c.name || 'Unknown')}*${score}`);
    if (c.price)     lines.push(`   💰 ${escapeMd(String(c.price))}`);
    if (c.lead_time) lines.push(`   ⏱ ${escapeMd(String(c.lead_time))}`);
    if (c.included)  lines.push(`   📦 ${escapeMd(String(c.included))}`);
    if (!c.responded) lines.push(`   _(no reply)_`);
    lines.push('');
  }

  if (report.recommendation?.winner_name) {
    lines.push(`🏆 *My pick: ${escapeMd(report.recommendation.winner_name)}*${report.recommendation.winner_username ? ` (@${escapeMd(report.recommendation.winner_username)})` : ''}`);
    if (report.recommendation.why) lines.push(`_${escapeMd(report.recommendation.why)}_`);
  }

  const inlineKb = [];
  if (report.recommendation?.winner_username) {
    inlineKb.push([
      { text: `🤝 Negotiate with @${report.recommendation.winner_username}`, callback_data: `b2b:campaign_negotiate:${campaign.id}` },
    ]);
  }
  inlineKb.push([
    { text: '📊 Open in dashboard', web_app: { url: `${APP_URL}/b2b?tab=research&id=${campaign.id}` } },
  ]);

  await tg(token, 'sendMessage', {
    chat_id: chat,
    text: lines.join('\n'),
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: inlineKb },
  });
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
  lines.push('', '_Reply when you can — no obligation._');
  return lines.join('\n');
}

/**
 * Use agentBrain.web_search-style search for non-MiniMe candidates.
 * Returns a small array of { title, url, snippet }.
 */
async function webSearchFallback(query) {
  try {
    // Try to reuse the same DuckDuckGo path used by agentBrain.
    // If not exposed, fall back to a minimal direct fetch.
    const res = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (MiniMe Research Agent)' },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const out = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g;
    let m; let i = 0;
    while ((m = re.exec(html)) && i < 5) {
      out.push({ url: m[1], title: stripHtml(m[2]), snippet: stripHtml(m[3]) });
      i++;
    }
    return out;
  } catch { return []; }
}

function stripHtml(s) { return String(s).replace(/<[^>]+>/g, '').trim(); }
function escapeMd(s) { return String(s || '').replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1'); }
