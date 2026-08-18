/**
 * Research Agent — owner says "find me the best X", we contact multiple
 * MiniMe businesses, collect responses, synthesize, and recommend.
 *
 * Rides entirely on top of b2b.js: each inquiry is a normal B2B message
 * tagged with a campaign_id so we can group the replies.
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { resolveToken } from './sendAs';
// Extensionless, matching every other local .js import in this file (./b2b,
// ./sendAs, ./telegramApi, ./db) — this one line was the outlier. The
// production error group "(0, s.parseBudget) is not a function" appeared for
// ~2.5h right after this import was introduced (commit b45f152) and never
// recurred; the leading theory is a webpack chunk-hash mismatch during that
// deploy's rollover on dynamically-imported modules (ownerCommands.js loads
// this file via `await import('./research')`). Normalizing the specifier
// removes the only asymmetry found and can't make things worse.
import { parseBudget } from './searchBot';
import { canonicalCategory } from './categoryMap.mjs';
import { buildLedger, groundReport } from './researchTruth.mjs';
import {
  sendBusinessMessage,
  searchBusinessesByCategory,
  getBusinessesByIds,
  findBusinessByUsername,
} from './b2b';

const MAX_TARGETS = 10;
const DEFAULT_TARGETS = 5;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || 'https://web-theta-one-68.vercel.app';

/**
 * Infer category from free-text query using AI.
 * Returns canonical category string (e.g., "branding", "laptops", "coffee", "printing").
 */
async function inferCategory(query) {
  try {
    const { makeOpenAI } = await import('./openaiClient');
    const oa = makeOpenAI();
    const r = await oa.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 50,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `Extract the product/service category from this business research query. Return ONLY the category as a single lowercase word/phrase.

Query: "${query}"

Examples:
- "branding agency under 50k ETB" → "branding"
- "laptop suppliers for business" → "laptops"
- "coffee beans wholesale" → "coffee"
- "printing flyers and banners" → "printing"
- "office furniture desks chairs" → "office furniture"
- "web development agency" → "web development"
- "legal services contract review" → "legal"
- "accounting tax filing" → "accounting"

Return JSON: { "category": "..." }`,
      }],
    });
    const raw = r.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw || '{}');
    return parsed.category?.toLowerCase().trim() || null;
  } catch (e) {
    console.warn('[research inferCategory]', e.message);
    return null;
  }
}

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

  // -1. Dedupe: refuse a near-identical campaign already running for this
  // business in the last 24h, rather than fanning out a second identical
  // blast. Live data showed three byte-identical "branding agency under 50k
  // ETB" campaigns launched the same day — each one re-messaging the same
  // real businesses.
  {
    const sbDedupe = supabase();
    const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const { data: recent } = await sbDedupe
      .from('research_campaigns')
      .select('id, query, status, created_at')
      .eq('business_id', business.id)
      .in('status', ['open', 'reporting'])
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(20);
    const dupe = (recent || []).find(
      c => String(c.query || '').trim().toLowerCase().replace(/\s+/g, ' ') === normalizedQuery,
    );
    if (dupe) {
      return {
        ok: false,
        error: 'duplicate_campaign',
        existing_campaign_id: dupe.id,
        message: `Already researching this — campaign started ${new Date(dupe.created_at).toLocaleString()}.`,
      };
    }
  }

  // 0. Infer category from query if not explicitly provided — must run before the
  // budget-from-history step below, which needs a category to look up past deals.
  if (!category) {
    const inferred = await inferCategory(query);
    category = canonicalCategory(inferred) || inferred;
  }

  // 0b. Parse budget from query text if not provided as structured object
  // Handles "50k", "under 100000", "50000-100000", etc.
  if (!budget || !budget.max) {
    const parsed = parseBudget(query);
    if (parsed && (parsed.max || parsed.min)) {
      budget = { ...budget, ...parsed, currency: budget?.currency || 'ETB' };
    }
  }

  // 0c. Auto-default budget from owner's history if still not provided
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

  // 2. Find MiniMe candidates — first try resolving "my X" partner references
  // (a known relationship the owner explicitly asked for; contacted
  // regardless of recent activity), then add generic category matches up to
  // the cap, restricted to businesses that are actually active. Measured on
  // the live database: outreach to an ever-active business gets replies 8.0%
  // of the time; to a never-active one, 1.6% — and 42% of every inquiry ever
  // sent went to the never-active group. Cold-blasting dormant accounts was
  // manufacturing the silence the synthesis step then had to fabricate an
  // answer for.
  const resolved = await resolvePartnerReference(business.id, query);
  const remainingSlots = Math.max(0, maxTargets - resolved.length);
  let audienceNote = null;
  const generic = [];
  if (remainingSlots > 0) {
    // Pull a wider pool than we need so the activity filter has room to
    // prefer active/warm candidates over dormant/never ones.
    const { isSynergyQuery, synergyCategoriesFor } = await import('./synergy.mjs');
    let pool;
    if (isSynergyQuery(query)) {
      // The inverted question — "who should I sell TO" rather than "who
      // sells what I need". A normal single-category search is the wrong
      // tool here: inferCategory on "potential B2B partners who'd benefit
      // from our platform" returns null or something like "business
      // services", which carries no discriminating signal. Instead, search
      // every category that plausibly wants what THIS business (the
      // searcher) offers.
      const myCategory = business.category_canonical || business.category;
      const targets = synergyCategoriesFor(myCategory);
      const seenIds = new Set();
      pool = [];
      for (const cat of targets) {
        const rows = await searchBusinessesByCategory(query, {
          category: cat, limit: remainingSlots * 2, excludeId: business.id,
        });
        for (const r of rows) if (!seenIds.has(r.id)) { seenIds.add(r.id); pool.push(r); }
      }
    } else {
      pool = await searchBusinessesByCategory(query, {
        category, limit: remainingSlots * 4, excludeId: business.id,
      });
    }
    const { selectByActivity } = await import('./b2bAudience.mjs');
    const picked = selectByActivity(pool, { count: remainingSlots });
    generic.push(...picked.selected);
    audienceNote = picked.message;
  }
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

  // 5. Send the inquiry to each MiniMe candidate (in parallel) — each gets
  // its own message, personalized with a real catalog item when one
  // genuinely matches the query. A one-line "I saw you carry X" is the
  // difference between an obvious mail-merge blast and a message that shows
  // the sender actually looked; omitted entirely (never invented) when no
  // catalog signal exists.
  const relevantProducts = await fetchRelevantProducts(candidates.map(c => c.id), query);
  const threadIds = [];
  await Promise.all(candidates.map(async (target) => {
    try {
      const inquiryText = formatInquiryMessage({
        query, questions: qList, budget, fromBiz: business,
        relevantProduct: relevantProducts.get(target.id) || null,
      });
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
    // Honest note when the active/warm pool couldn't fill every slot —
    // surfaced to the owner rather than silently padding with dormant shops.
    audience_note: audienceNote,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  Reply-driven progression
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Called from b2b.recordReply whenever a reply lands on a campaign-tagged
 * thread. Bumps reply_count, fires interim DM, and may trigger synthesis.
 *
 * Completion is judged on DISTINCT responders, not raw reply count — a single
 * target replying twice must not complete a campaign whose other targets have
 * never answered (the old `newCount >= total` check could ship a premature
 * "final" comparison).
 */
export async function processReplyForCampaign({ replyRow, originalRow, campaignId }) {
  const sb = supabase();
  const { data: campaign } = await sb
    .from('research_campaigns').select('*').eq('id', campaignId).maybeSingle();
  if (!campaign || campaign.status !== 'open') return;

  const newCount = (campaign.reply_count || 0) + 1;
  const total = (campaign.target_ids || []).length;
  const updates = { reply_count: newCount };

  // Distinct responders among the contacted targets — the denominator the
  // completion check must use. Cheap: bounded by 10 targets × their replies.
  let respondedCount = 0;
  try {
    const { data: replyRows } = await sb
      .from('business_messages')
      .select('sender_id')
      .in('thread_id', campaign.thread_ids || [])
      .in('sender_id', campaign.target_ids || []);
    respondedCount = new Set((replyRows || []).map(r => String(r.sender_id))).size;
  } catch (e) {
    // Fall back to the message count rather than stalling the reply path.
    console.warn('[research] responder count query failed:', e.message);
    respondedCount = newCount;
  }

  // Interim DM at 50% (of distinct responders).
  const halfway = Math.ceil(total / 2);
  if (respondedCount >= halfway && !campaign.interim_sent_at && respondedCount < total) {
    updates.interim_sent_at = new Date().toISOString();
    sendInterimReport({ campaign, newCount: respondedCount, total }).catch(e => console.warn('[interim]', e.message));
  }

  const { error: upErr } = await sb.from('research_campaigns').update(updates).eq('id', campaignId);
  if (upErr) {
    console.error('[research] update campaign', campaignId, upErr.message);
    return;
  }

  // Synthesize when every target has replied at least once.
  if (respondedCount >= total) {
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

  const targets = await getBusinessesByIds(campaign.target_ids || []);
  const ledger = buildLedger({ campaign, targets, messages: msgs || [] });

  // Run AI synthesis — but only spend a model call, and only give the model
  // words, when someone actually replied. Zero replies is not a synthesis
  // problem; it's the honest answer, and groundReport renders it directly.
  const modelJson = ledger.respondedCount > 0 ? await aiSynthesize({
    query: campaign.query,
    category: campaign.category,
    budget: campaign.budget,
    questions: campaign.questions || [],
    ledger,
  }) : {};
  const report = groundReport(modelJson, ledger);

  await sb.from('research_campaigns').update({
    status: 'complete',
    report,
    completed_at: new Date().toISOString(),
  }).eq('id', campaignId);

  // Deliver
  await deliverReport({ campaign: { ...campaign, report } });
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

/**
 * The model is an analyst over quoted evidence here, not an author. It may
 * only state a factual field (price, lead_time, ...) if it cites the exact
 * message id the number came from; researchTruth.groundReport() strips
 * anything that doesn't. Non-responders are not sent to the model at all —
 * there's nothing for it to analyze, and the ledger already knows they're
 * silent.
 */
async function aiSynthesize({ query, category, budget, questions, ledger }) {
  try {
    const { makeOpenAI } = await import('./openaiClient');
    const oa = makeOpenAI();

    const responders = [...ledger.byId.entries()].filter(([, e]) => e.responded);
    const responsesText = responders.map(([id, entry]) => {
      const msgsTxt = entry.messages
        .map(m => `  [msg_id: ${m.id}] ${m.content}`)
        .join('\n');
      return `CANDIDATE candidate_id="${id}" name="${entry.business.name}"\n${msgsTxt}`;
    }).join('\n\n');

    const r = await oa.chat.completions.create({
      model: 'gpt-4.1',
      temperature: 0.1,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `You are analyzing real supplier replies for an Ethiopian SMB owner's request. You may ONLY use facts present in the quoted messages below — never invent a name, price, or term that isn't in a message. Every factual field you fill in MUST cite the exact msg_id it came from, in a matching "<field>_source_message_id" key. If a candidate's messages don't mention a fact, omit that field entirely rather than guessing.

THE OWNER'S REQUEST: "${query}"
${category ? `CATEGORY: ${category}\n` : ''}${budget?.max ? `BUDGET: up to ${budget.max.toLocaleString()} ${budget.currency || 'ETB'}\n` : ''}
QUESTIONS ASKED:
${(questions || []).map((q, i) => `${i+1}. ${q}`).join('\n')}

REAL REPLIES RECEIVED (candidate_id and msg_id are the only valid ids — never invent one):
${responsesText || '(no replies)'}

INSTRUCTIONS:
1. For each candidate with replies, extract only what they actually said: price, lead time, scope, payment terms, guarantees — each with its source msg_id.
2. Opinions (pros/cons/red_flags/green_flags) may reason ABOUT the quoted text but must not introduce new facts.
3. Recommend a winner ONLY among candidates who replied, using their real candidate_id.

Return JSON (no markdown):
{
  "comparison": [
    {
      "candidate_id": "<the candidate_id given above, verbatim>",
      "price": "...", "price_source_message_id": "<msg_id>",
      "price_breakdown": "...", "price_breakdown_source_message_id": "<msg_id>",
      "lead_time": "...", "lead_time_source_message_id": "<msg_id>",
      "included": "...", "included_source_message_id": "<msg_id>",
      "excluded": "...", "excluded_source_message_id": "<msg_id>",
      "payment_terms": "...", "payment_terms_source_message_id": "<msg_id>",
      "guarantees": "...", "guarantees_source_message_id": "<msg_id>",
      "pros": ["..."], "cons": ["..."], "red_flags": ["..."], "green_flags": ["..."],
      "scores": { "value": 8, "speed": 7, "reliability": 9, "fit": 8, "terms": 7 },
      "overall_score": 7.8
    }
  ],
  "recommendation": {
    "winner_id": "<a candidate_id from above that replied>",
    "why": "3-4 sentences grounded only in what they actually said",
    "negotiation_levers": ["Push for X", "Concede on Y"],
    "next_step_suggestion": "negotiate|order|chat|none"
  },
  "market_context": "1-2 sentences on typical market rate for this category, phrased as general knowledge, not a claim about these specific candidates",
  "summary_line": "One-sentence executive takeaway"
}`,
      }],
    });
    const raw = r.choices?.[0]?.message?.content;
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.warn('[research aiSynthesize]', e.message);
    return {};
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Delivery — DM the report to the owner
// ──────────────────────────────────────────────────────────────────────────────

async function deliverReport({ campaign }) {
  const sb = supabase();
  const { data: biz } = await sb.from('businesses')
    .select('telegram_bot_token_enc, owner_telegram_id, owner_private_chat_id, name, shop_code, onboarding_completed')
    .eq('id', campaign.business_id).maybeSingle();
  if (!biz) return;
  // resolveToken() falls back to the shared @MiniMeAgentBot for
  // shop_code/Secretary-Mode tenants. Directly decrypting the token column
  // here used to silently drop 868 of 887 registered businesses (98% have
  // no dedicated bot) — the research report was being built correctly and
  // then almost never delivered.
  const token = resolveToken(biz, { as: 'bot' });
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

  // Honest zero-reply case — no comparison rows exist at all when nobody
  // answered (researchTruth.groundReport refuses to invent one).
  if (report.no_replies) {
    lines.push(`⚪ *Nobody has replied yet.*`);
    lines.push(`We asked ${total} real, active MiniMe business${total === 1 ? '' : 'es'} — no invented names, no guesses.`);
    lines.push('');
    lines.push(`👉 *Next step:* wait a bit longer, or widen the search.`);
    const inlineKb = [[
      { text: '📊 Open in Dashboard', web_app: { url: `${APP_URL}/b2b?tab=research&id=${campaign.id}` } },
    ]];
    const text = lines.join('\n');
    await tg(token, 'sendMessage', { chat_id: chat, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKb } });
    return;
  }

  if (report.market_context) {
    lines.push(`📈 *Market Context:* ${escapeMd(report.market_context)}`);
    lines.push('');
  }

  // Detailed comparison for each candidate — every field here is either a
  // real DB value or a model claim that cited a real message id
  // (researchTruth.groundReport strips anything that didn't).
  for (const c of report.comparison || []) {
    const tag = c.responded ? `🟢` : `⚪`;
    const score = c.overall_score ? ` · ${c.overall_score}/10` : '';
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

    // The receipt — every claim above traces back to what they actually
    // said. This is the answer to "how do I know this isn't invented".
    if (c.quotes?.length) {
      const latest = c.quotes[c.quotes.length - 1];
      const when = latest.created_at ? new Date(latest.created_at).toLocaleDateString() : '';
      lines.push(`   💬 _"${escapeMd(truncate(latest.content, 140))}"_ — their reply${when ? `, ${when}` : ''}`);
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

    lines.push(`👉 *Next Step:* ${report.recommendation.next_step_suggestion || 'negotiate'}`);
  }

  if (report.summary_line) {
    lines.push('', `💡 *Executive Summary:* ${escapeMd(report.summary_line)}`);
  }

  const inlineKb = [];
  // The recommendation itself was validated against the ledger in
  // groundReport(), so a winner_username here is always a real business.
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
    .select('telegram_bot_token_enc, owner_telegram_id, owner_private_chat_id, shop_code, onboarding_completed')
    .eq('id', campaign.business_id).maybeSingle();
  if (!biz) return;
  const token = resolveToken(biz, { as: 'bot' });
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
 * Fetch, per target business, one active product whose name/description
 * genuinely matches the query (word-boundary matching, not substring —
 * reuses the same matcher b2b.js's catalog search uses). Returns a Map from
 * business id to a product name, or nothing for a business with no
 * matching catalog signal — never a guess, never invented.
 */
async function fetchRelevantProducts(businessIds, query) {
  const out = new Map();
  if (!businessIds?.length) return out;
  const { singularize, wordMatch } = await import('./searchRanker.mjs');
  const kws = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(w => singularize(w.replace(/[^\p{L}\p{N}]/gu, '')))
    .filter(w => w.length > 2);
  if (!kws.length) return out;

  const sb = supabase();
  const { data: products } = await sb
    .from('products')
    .select('business_id, name, description')
    .in('business_id', businessIds)
    .eq('is_active', true)
    .limit(200);

  for (const p of products || []) {
    if (out.has(p.business_id)) continue; // first genuine match wins
    const text = [p.name, p.description].filter(Boolean);
    if (kws.some(kw => text.some(t => wordMatch(t, kw)))) {
      out.set(p.business_id, p.name);
    }
  }
  return out;
}

/**
 * Format the inquiry message we send to each target business.
 */
function formatInquiryMessage({ query, questions, budget, fromBiz, relevantProduct }) {
  const lines = [
    `Hi! ${fromBiz.name || 'A business'} on MiniMe is researching options and would love your input:`,
  ];
  if (relevantProduct) {
    lines.push(`_I saw you carry_ *${escapeMd(relevantProduct)}* _— that's why I'm reaching out._`);
  }
  lines.push('', `*Looking for:* ${query}`);
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

