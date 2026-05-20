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
import { MODEL, MODEL_MINI } from './constants';

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

// Re-export the raw OpenAI client for non-logged call sites
export const openai = client();
