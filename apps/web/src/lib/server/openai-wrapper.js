/**
 * Centralised OpenAI completion wrapper.
 *
 * Goals:
 *   1. Log every call to `llm_call_log` (route, model, tokens, latency, ok) for cost tracking.
 *   2. Auto-rollback: if a downgraded route's failure rate exceeds 5% over the last
 *      50 calls, force it back to MODEL and alert the platform admin.
 *   3. Thin pass-through — call sites that don't pass `route` behave identically to
 *      the raw openai client.
 */
import OpenAI from 'openai';
import { supabase } from './db';
import { MODEL, MODEL_MINI, EMBED_MODEL } from './constants';

let _client;
function client() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });
  return _client;
}

// In-memory cache of forced-model overrides — refreshed every 60s.
let _routeOverrides = {};
let _overridesAt = 0;

async function getRouteOverride(route) {
  if (!route) return null;
  if (Date.now() - _overridesAt < 60000) return _routeOverrides[route] || null;
  try {
    const { data } = await supabase()
      .from('llm_route_state')
      .select('route, forced_model');
    _routeOverrides = {};
    for (const row of data || []) _routeOverrides[row.route] = row.forced_model;
    _overridesAt = Date.now();
  } catch {}
  return _routeOverrides[route] || null;
}

// gpt-4.1 per-token pricing (USD per 1M tokens) — rough estimates
const PRICING = {
  'gpt-4.1':       { in: 2.50, out: 10.00 },
  'gpt-4.1-mini':  { in: 0.40, out: 1.60 },
  'gpt-4.1-nano':  { in: 0.10, out: 0.40 },
  'gpt-4o':        { in: 2.50, out: 10.00 },
  'gpt-4o-mini':   { in: 0.15, out: 0.60 },
};
function estimateCost(model, promptTokens, completionTokens) {
  const p = PRICING[model] || PRICING['gpt-4.1'];
  return ((promptTokens || 0) * p.in + (completionTokens || 0) * p.out) / 1_000_000;
}

/**
 * Log a single LLM call to llm_call_log (fire-and-forget).
 */
function logCall(row) {
  // Fire-and-forget — never block on logging
  supabase().from('llm_call_log').insert(row).then(() => {}).catch(() => {});
}

/**
 * Async: examine recent calls for this route, force rollback if failure rate > 5%.
 */
async function maybeAutoRollback(route, businessId) {
  if (!route) return;
  try {
    const sb = supabase();
    const { data: recent } = await sb.from('llm_call_log')
      .select('ok, model')
      .eq('route', route)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!recent || recent.length < 30) return; // need enough data
    const fails = recent.filter(r => !r.ok).length;
    const failRate = fails / recent.length;
    if (failRate <= 0.05) return;

    // Already rolled back?
    const { data: state } = await sb.from('llm_route_state').select('forced_model').eq('route', route).maybeSingle();
    if (state?.forced_model) return;

    // Force back to MODEL (gpt-4.1) and alert admin
    await sb.from('llm_route_state').upsert({
      route,
      forced_model: MODEL,
      failures_recent: fails,
      rollback_reason: `Failure rate ${Math.round(failRate * 100)}% over last ${recent.length} calls`,
      rolled_back_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    _routeOverrides[route] = MODEL;
    _overridesAt = Date.now();
    console.warn(`[llm-rollback] ${route} → ${MODEL} (failures ${fails}/${recent.length})`);

    // Notify platform admin via Telegram (best effort)
    const adminId = process.env.PLATFORM_ADMIN_TELEGRAM_ID;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (adminId && botToken) {
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminId,
          text: `⚠️ *LLM rollback*\n\nRoute \`${route}\` rolled back to ${MODEL} after ${Math.round(failRate * 100)}% failure rate (${fails}/${recent.length} recent calls).`,
          parse_mode: 'Markdown',
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
  } catch (e) { console.warn('maybeAutoRollback:', e.message); }
}

/**
 * Drop-in replacement for openai.chat.completions.create() with logging and rollback.
 *
 * Usage:
 *   const res = await loggedCompletion({
 *     route: 'job_detector',          // required for logging/rollback
 *     business_id: businessId,        // optional
 *     model: MODEL_MINI,              // the desired model
 *     messages: [...],
 *     ...other openai params,
 *   });
 */
export async function loggedCompletion(opts) {
  const { route, business_id, model, ...rest } = opts;
  const override = await getRouteOverride(route);
  const finalModel = override || model;

  const t0 = Date.now();
  let res, err, ok = false;
  try {
    res = await client().chat.completions.create({ model: finalModel, ...rest });
    ok = true;
    // Detect parse failures even if HTTP succeeded — empty content is a fail signal
    const content = res?.choices?.[0]?.message?.content;
    if (rest.response_format?.type === 'json_object' && content) {
      try { JSON.parse(content); } catch { ok = false; }
    } else if (content !== undefined && (!content || content.trim() === '')) {
      ok = false;
    }
  } catch (e) {
    err = e;
    ok = false;
  }
  const latency = Date.now() - t0;
  const usage = res?.usage || {};

  if (route) {
    logCall({
      business_id: business_id || null,
      route,
      model: finalModel,
      ok,
      latency_ms: latency,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_cost_usd: estimateCost(finalModel, usage.prompt_tokens, usage.completion_tokens),
    });
    // Examine failure rate occasionally — don't block the call
    if (!ok) setTimeout(() => maybeAutoRollback(route, business_id), 0);
  }

  if (err) throw err;
  return res;
}

/**
 * Fire-and-forget: generate 3-8 keyword tags from a business description
 * and persist them to the businesses table.  Uses MODEL_MINI for speed/cost.
 */
export async function generateAutoTags(businessId, text) {
  try {
    const res = await loggedCompletion({
      route: 'auto_tagging',
      business_id: businessId,
      model: MODEL_MINI,
      temperature: 0.2,
      max_tokens: 150,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a B2B keyword tagger. Given a business description, extract 3-8 lowercase ' +
            'English keyword tags that would help other businesses find this one. ' +
            'Focus on products, services, materials, and specialities. ' +
            'Return JSON: {"tags":["tag1","tag2"]}',
        },
        { role: 'user', content: text },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content);
    const tags = (Array.isArray(raw.tags) ? raw.tags : [])
      .map(t => String(t).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
    if (tags.length) {
      await supabase().from('businesses').update({ tags }).eq('id', businessId);
    }
  } catch (e) {
    console.warn('[auto-tags]', e.message);
  }
}

/**
 * Fire-and-forget: generate a rich search embedding for a business.
 *
 * Pulls in everything the business knows about itself so the search bot
 * can match on products, FAQs, services — not just the short description.
 *
 * Seed structure (capped at 8000 chars):
 *   name · category · description · tags
 *   Products: [name: description, price]
 *   FAQs/replies: [trigger questions]
 *   Instructions: [owner-defined business info]
 *   Knowledge: [document titles]
 */
export async function generateSearchEmbedding(businessId, baseSeed) {
  try {
    const sb = supabase();
    const parts = [baseSeed || ''];

    // ── Products ──────────────────────────────────────────────────────────
    try {
      const { data: products } = await sb
        .from('products')
        .select('name, name_am, description, price, currency, category')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .limit(30);
      if (products?.length) {
        const productText = products.map(p => {
          const price = p.price != null ? ` (${Number(p.price).toLocaleString()} ${p.currency || 'ETB'})` : '';
          const desc  = p.description ? `: ${p.description.slice(0, 80)}` : '';
          return `${p.name}${p.name_am ? `/${p.name_am}` : ''}${price}${desc}`;
        }).join('; ');
        parts.push(`Products: ${productText}`);
      }
    } catch {}

    // ── Sample replies (FAQs / common Q&A) ───────────────────────────────
    try {
      const { data: biz } = await sb
        .from('businesses')
        .select('sample_replies, owner_instructions')
        .eq('id', businessId)
        .single();

      if (biz?.sample_replies?.length) {
        const faqs = biz.sample_replies
          .slice(0, 10)
          .map(r => r.trigger || r.question || r.keyword || '')
          .filter(Boolean)
          .join('; ');
        if (faqs) parts.push(`FAQs: ${faqs}`);

        const answers = biz.sample_replies
          .slice(0, 5)
          .map(r => (r.reply || r.answer || '').slice(0, 120))
          .filter(Boolean)
          .join(' | ');
        if (answers) parts.push(`About: ${answers}`);
      }

      if (biz?.owner_instructions?.length) {
        const instructions = biz.owner_instructions
          .slice(0, 8)
          .map(r => (r.content || r.instruction || r.rule || '').slice(0, 100))
          .filter(Boolean)
          .join('; ');
        if (instructions) parts.push(`Services: ${instructions}`);
      }
    } catch {}

    // ── Document titles (knowledge base) ─────────────────────────────────
    try {
      const { data: docs } = await sb
        .from('documents')
        .select('title, description')
        .eq('business_id', businessId)
        .limit(10);
      if (docs?.length) {
        const docText = docs.map(d => `${d.title || ''}${d.description ? `: ${d.description.slice(0, 60)}` : ''}`).filter(Boolean).join('; ');
        if (docText) parts.push(`Knowledge: ${docText}`);
      }
    } catch {}

    const seed = parts.filter(Boolean).join('\n').slice(0, 8000);

    const r = await client().embeddings.create({
      model: EMBED_MODEL,
      input: [seed],
    });
    await supabase()
      .from('businesses')
      .update({ search_embedding: r.data[0].embedding })
      .eq('id', businessId);

    console.log(`[search-embedding] ${businessId} — ${seed.length} chars, ${parts.length} sections`);
  } catch (e) {
    console.warn('[search-embedding]', e.message);
  }
}

// Re-export the raw OpenAI client for non-logged call sites
export const openai = client();
