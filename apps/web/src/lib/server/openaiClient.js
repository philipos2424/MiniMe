import OpenAI from 'openai/index.js';
import { logCall, inferRoute } from './llmCallLog.mjs';
import { estimateCost } from './llmPricing.mjs';

const GPT_55 = 'gpt-5.5';
// "gpt-5.5-pro" IS listed by /v1/models, but it is NOT a chat model — calling it
// on /v1/chat/completions returns 404 "This is not a chat model and thus not
// supported in the v1/chat/completions endpoint". Verified against the live API.
// This previously resolved to the literal 'gpt-5.5-pro', so every call site
// passing a non-mini legacy name (b2b.js and research.js pass 'gpt-4.1') 404'd
// on OpenAI, fell through Groq and Gemini, and landed on fallbackOllamaFetch —
// which returns a canned "Hi! How can I help?" instead of a real answer.
// 
// VALID MODELS (as of 2026-08): gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, o1-preview, o1-mini
// gpt-5.x models are NOT yet available on chat.completions endpoint.
const GPT_55_PRO = 'gpt-4.1'; // Default to actual available model

export function normalizeModelName(model, { fast = false } = {}) {
  const raw = `${model || ''}`.trim();
  if (!raw) return fast ? GPT_55 : GPT_55_PRO;

  const lower = raw.toLowerCase();
  // Catch *-pro before the gpt-5.5 passthrough, or it 404s on chat.completions.
  if (/-pro\b/.test(lower)) return GPT_55_PRO;
  if (lower.startsWith('gpt-5.5')) return raw;
  // gpt-4o-mini, gpt-4.1-mini are valid models — don't map them to gpt-5.5!
  if (lower.includes('gpt-4o-mini') || lower.includes('gpt-4.1-mini')) return raw;
  if (lower.includes('gpt-5.6') || lower.includes('gpt-4.1') || lower.includes('gpt-4o')) return GPT_55_PRO;
  if (lower.includes('llama') || lower.includes('gemma') || lower.includes('gemini')) {
    return fast ? GPT_55 : GPT_55_PRO;
  }
  // Only map generic 'mini'/'nano'/'fast' to fast model if not an explicit gpt-4* variant
  if (lower.includes('mini') || lower.includes('nano') || lower.includes('fast')) return GPT_55;
  return raw;
}

/**
 * Universal Multi-Provider AI Client Pool & Infallible Proxy Wrapper
 *
 * GPT is the default path when an OpenAI key is present.
 * Groq, Gemini, and Ollama remain as explicit backups.
 *
 * Auto-sanitizes params (e.g. strips presence_penalty / frequency_penalty)
 * so non-OpenAI endpoints never reject requests with INVALID_ARGUMENT (400).
 */
export function sanitizeParams(params, isGeminiOrOllama = true) {
  const clean = { ...params };
  if (isGeminiOrOllama) {
    delete clean.presence_penalty;
    delete clean.frequency_penalty;
    delete clean.user;
    // OpenAI-only knob — Gemini's compat layer and Ollama reject it.
    delete clean.reasoning_effort;
  }
  return clean;
}

// gemini-3.5-flash thinks by default and the thinking counts against max_tokens:
// at 400 tokens it spent ~380 on thought and the customer got half a word of
// Amharic (finish_reason "length"). 'minimal' answers in full; 'low' — what
// EFFORT_BRAIN maps to — truncated the same way. Verified against the live API.
// Matches the vector(1536) columns, so no schema change was needed when
// embeddings moved from OpenAI's text-embedding-3-small to Gemini.
export const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIMS = 1536;

// Call sites pass similarity cutoffs calibrated for OpenAI's embeddings, where
// unrelated text scores ~0.1 and good matches 0.3-0.5. Gemini's scale sits
// higher: unrelated 0.39-0.55, matches 0.52-0.71 (measured on Amharic and
// English product queries, 2026-10-08). Converting at the RPC boundary keeps
// every caller's relative strictness without touching 17 call sites.
export function geminiThreshold(openaiThreshold) {
  return Math.round((0.45 + 0.35 * openaiThreshold) * 1000) / 1000;
}

// JSON caps were sized for OpenAI and a truncated object is a hard parse
// failure, not a shorter answer: onboarding_offerings asked for ~330 tokens
// under a 260 cap and fell back to template questions on every signup.
// The model stops at the closing brace, so the floor costs nothing extra.
const GEMINI_JSON_MIN_TOKENS = 1024;

export function withGeminiThinking(params, providerName) {
  if (!providerName.includes('Gemini')) return params;
  const out = { ...params, reasoning_effort: 'minimal' };
  if (out.response_format?.type === 'json_object' && out.max_tokens != null && out.max_tokens < GEMINI_JSON_MIN_TOKENS) {
    out.max_tokens = GEMINI_JSON_MIN_TOKENS;
  }
  return out;
}

// Ollama Cloud's models (gemma4, gpt-oss) think before answering and the
// thinking counts against max_tokens, the same trap as Gemini: gpt-oss:20b at
// a 20-token cap spent all 20 on reasoning and returned "" (verified against
// ollama.com/v1, 2026-10-17). Call sites pass caps as low as 5, so floor them.
// A local Ollama (no key) keeps the caller's cap.
const OLLAMA_MIN_TOKENS = 1024;

export function withOllamaHeadroom(params, providerName) {
  if (!providerName.includes('Ollama') || !process.env.OLLAMA_API_KEY) return params;
  if (params.max_tokens == null || params.max_tokens >= OLLAMA_MIN_TOKENS) return params;
  return { ...params, max_tokens: OLLAMA_MIN_TOKENS };
}

// The lowest reasoning setting gpt-5.5 accepts. 'minimal' is NOT valid on this
// model — it 400s with "Supported values are: 'none', 'low', 'medium', 'high',
// and 'xhigh'". Verified against the live API.
const NO_REASONING = 'none';

// Absolute floor for max_completion_tokens. With reasoning disabled a YES/NO
// answer costs ~4 tokens, so this is headroom, not a budget.
const MIN_COMPLETION_TOKENS = 16;

// gpt-5.x rejects `max_tokens` on /v1/chat/completions ("Unsupported parameter") —
// it wants `max_completion_tokens` instead. Translate transparently so none of the
// ~30 call sites across the codebase need to change.
export function sanitizeForRealOpenAI(params, model) {
  const clean = { ...params };
  if (/^gpt-5/.test(model || '')) {
    if (clean.max_tokens !== undefined && clean.max_completion_tokens === undefined) {
      clean.max_completion_tokens = clean.max_tokens;
      delete clean.max_tokens;
    }

    // gpt-5.x spends part of the budget on hidden reasoning tokens BEFORE the
    // visible reply, so a low cap (call sites here were written for gpt-4o and
    // pass 150-900) could exhaust the whole budget on reasoning and return an
    // empty completion — measured: cap=24 with reasoning on returns "" with
    // finish_reason 'length'.
    //
    // This used to be handled by flooring every cap up to 2000, which fixed the
    // symptom by letting reasoning run unconstrained on every call in the app.
    // Disabling reasoning fixes the cause: the same call returns "NO" in 4
    // tokens with 0 reasoning tokens. Callers that genuinely need reasoning
    // (tool-calling loops) pass reasoning_effort explicitly and keep their cap.
    if (clean.reasoning_effort === undefined) {
      clean.reasoning_effort = NO_REASONING;
    }
    if (clean.reasoning_effort !== NO_REASONING) {
      // Reasoning is on by explicit request — restore the old headroom so it
      // can't starve the visible answer.
      if (clean.max_completion_tokens !== undefined && clean.max_completion_tokens < 2000) {
        clean.max_completion_tokens = 2000;
      }
    } else if (clean.max_completion_tokens !== undefined) {
      clean.max_completion_tokens = Math.max(clean.max_completion_tokens, MIN_COMPLETION_TOKENS);
    }

    // gpt-5.x only supports default sampling params — custom values 400.
    delete clean.temperature;
    delete clean.top_p;
    delete clean.presence_penalty;
    delete clean.frequency_penalty;
    delete clean.logprobs;
    delete clean.top_logprobs;
  }
  return clean;
}

async function fallbackOllamaFetch(params) {
  const model = process.env.OLLAMA_MODEL || 'gemma3:4b';
  const url = `${process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1'}`
    .replace('localhost', '127.0.0.1')
    .replace(/\/+$/, '') + '/chat/completions';
  const body = withOllamaHeadroom(sanitizeParams({
    model,
    messages: params.messages || [],
    temperature: params.temperature,
    max_tokens: params.max_tokens,
    response_format: params.response_format,
  }, true), 'Ollama');
  // Ollama Cloud (ollama.com/v1) needs the key; a local Ollama ignores it.
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OLLAMA_API_KEY) headers.Authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;

  // This is the last-resort attempt after every configured provider (OpenAI,
  // Groq, Gemini) has already failed. It used to swallow its own failure and
  // fabricate a well-formed completion — content 'Hi! How can I help?', a
  // real finish_reason — so callers (and customers) couldn't tell a fake
  // greeting from an actual answer. Throw instead: draftReply's caller
  // already sends an honest apology + alerts the owner when generation
  // fails outright, which beats a made-up reply the merchant never approved.
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`Ollama HTTP error ${resp.status}`);
  }
  return await resp.json();
}

export function getProviderClients() {
  const clients = [];

  const preferOllama = process.env.USE_OLLAMA === 'true'
    || process.env.OLLAMA_ENABLED === 'true'
    || process.env.OPENAI_API_KEY === 'ollama'
    || !!(process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.includes('11434'));

  const rawOllamaUrl = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
  const ollamaBaseUrl = rawOllamaUrl.replace('localhost', '127.0.0.1').replace(/\/+$/, '');
  const defaultOllamaModel = process.env.OLLAMA_MODEL || 'gemma3:4b';
  const ollamaProvider = {
    name: 'Ollama (Local LLM)',
    client: new OpenAI({
      apiKey: process.env.OLLAMA_API_KEY || 'ollama',
      baseURL: ollamaBaseUrl,
      timeout: 60_000,
      maxRetries: 0,
    }),
    defaultModel: defaultOllamaModel,
  };

  const primaryKey = process.env.OPENAI_API_KEY;
  const openaiEntry = (primaryKey && primaryKey !== 'sk-placeholder' && primaryKey !== 'ollama')
    ? {
      name: 'OpenAI (Primary API Key)',
      client: new OpenAI({
        apiKey: primaryKey,
        baseURL: process.env.OPENAI_BASE_URL && !process.env.OPENAI_BASE_URL.includes('11434')
          ? process.env.OPENAI_BASE_URL.replace(/\/+$/, '')
          : undefined,
        timeout: 45_000,
        maxRetries: 1,
      }),
    }
    : null;

  const groqEntry = (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'sk-placeholder')
    ? {
      name: 'Groq (Ultra-Fast API)',
      client: new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
        timeout: 30_000,
        maxRetries: 1,
      }),
      // llama-3.1-8b-instant was RETIRED by Groq on 2026-08-16 (console.groq.com/docs/
      // deprecations) — every request to it errors, so with it as the default a
      // Gemini failure on any plain chat call left no working fallback at all.
      // openai/gpt-oss-20b is Groq's recommended replacement, the same family as
      // the toolModel below that is already proven on this provider.
      defaultModel: 'openai/gpt-oss-20b',
      // agentBrain.js / teamBrain.js pass `tools` + `reasoning_effort` — this is where
      // the small model fails in practice: it hallucinates tool names outside the
      // schema (verified: "attempted to call tool 'delegate' which was not in
      // request.tools" on a plain "how do I delegate" message). gpt-oss-120b handled the
      // same tool-calling prompts correctly at the real 2000-token budget the brain uses.
      // Reserved for tool-calling calls only — it eats far more of Groq's free 8k TPM
      // budget than the 8b model, so using it for every message would burn the quota fast.
      toolModel: 'openai/gpt-oss-120b',
    }
    : null;

  const geminiEntry = (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'sk-placeholder')
    ? {
      name: 'Google Gemini (Free API)',
      client: new OpenAI({
        apiKey: process.env.GEMINI_API_KEY,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        timeout: 45_000,
        maxRetries: 1,
      }),
      // Pro models left Gemini's free tier in April 2026 — Flash is the smartest
      // model still available on a free key. gemini-2.5-flash is prior-gen now.
      defaultModel: 'gemini-3.5-flash',
    }
    : null;

  // OpenAI billing ran out (429 "no credits remaining", 2026-08-14) — with it
  // first in line every single request wasted a guaranteed-fail round trip
  // before ever reaching a provider that could actually answer. Deprioritized
  // behind Groq/Gemini until credits are topped up; set AI_OPENAI_FIRST=true
  // (Vercel env var, no code change needed) to restore OpenAI-first once fixed.
  const openaiFirst = process.env.AI_OPENAI_FIRST === 'true';
  // Gemini is the primary provider (new Google key, 2026-10-08) — Groq's free
  // 8k TPM budget is now the first fallback rather than the main path.
  const orderedEntries = openaiFirst
    ? [openaiEntry, geminiEntry, groqEntry]
    : [geminiEntry, groqEntry, openaiEntry];
  for (const entry of orderedEntries) if (entry) clients.push(entry);

  if (preferOllama) {
    clients.unshift(ollamaProvider);
  } else if (!ollamaUnreachable()) {
    clients.push(ollamaProvider);
  }

  return clients;
}

// On Vercel a loopback Ollama URL (the default when OLLAMA_BASE_URL is unset)
// points at nothing, so the hop is a guaranteed failure on every exhausted
// chain. Ollama Cloud (OLLAMA_BASE_URL=https://ollama.com/v1) is reachable.
function ollamaUnreachable() {
  const url = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
  return !!process.env.VERCEL && /127\.0\.0\.1|localhost/.test(url);
}

// ── Lanes ────────────────────────────────────────────────────────────────────
// The fallback providers are small free tiers: Groq meters ~200k tokens a day
// (live 2026-10-15: "TPD: Limit 200000, Used 199673") and Ollama Cloud's free
// plan has its own caps. When crons and post-reply housekeeping fell back to
// them, they spent the budget before a customer needed it. Background work has
// nobody waiting, so it runs on Gemini only and simply retries next run.
//
// A call is background when its route is listed here, or when the caller
// passes lane: 'background' (the follow-ups cron running the agent brain).
export const BACKGROUND_ROUTES = new Set([
  'auto_learn', 'knowledge_gaps', 'owner_facts', 'self_improve',
  'reminder_proposer', 'learn_from_chat', 'auto_character', 'auto_tagging',
  'conversation_summary', 'conversation_rollup', 'conversation_digest',
  'extract_customer_facts', 'extract_owner_commitments', 'analytics_questions',
  'dimts_followup',
]);

export function laneFor(route, lane) {
  if (lane) return lane;
  return BACKGROUND_ROUTES.has(route) ? 'background' : 'customer';
}

// A provider that says the account has no money left will say it again on
// every request: OpenAI has answered 429 "insufficient_quota" since
// 2026-08-14, so each exhausted chain paid a dead round trip to it. Bench it
// for a few minutes per warm instance; a top-up is picked up on its own.
export const NO_CREDITS_BENCH_MS = Number(process.env.AI_NO_CREDITS_BENCH_MS || 5 * 60_000);
const benchedUntil = new Map();

export function noteProviderFailure(provider, error) {
  const msg = `${error?.message || ''} ${error?.code || ''} ${error?.error?.code || ''}`;
  // "per day" / "PerDay": a spent daily quota (Gemini, Groq TPD) — a per-minute
  // 429 clears in seconds and is deliberately not benched.
  if (/insufficient_quota|no credits|exceeded your current quota|billing|spending cap|spend cap|per ?day/i.test(msg)) {
    benchedUntil.set(provider.name, Date.now() + NO_CREDITS_BENCH_MS);
  }
}

/** Test hook: forget every bench. */
export function resetProviderBench() {
  benchedUntil.clear();
}

/**
 * The chain one call walks. Customer calls get every provider that is not
 * benched (or all of them, if everything is benched — a guess beats silence
 * when someone is waiting). Background calls get Gemini only, and nothing at
 * all while Gemini is benched; the caller's catch handles it.
 */
export function selectProviders(clients, { lane = 'customer' } = {}) {
  const now = Date.now();
  const awake = clients.filter(c => !(benchedUntil.get(c.name) > now));
  if (lane === 'background' && clients.some(c => c.name.includes('Gemini'))) {
    return awake.filter(c => c.name.includes('Gemini'));
  }
  return awake.length ? awake : clients;
}

/**
 * Record one provider attempt made through makeOpenAI().
 *
 * loggedCompletion() (openai-wrapper.js) logs one row per fallback chain for
 * the call sites that pass `route`. The sites that use makeOpenAI() directly —
 * the agent/team brains' tool loops, auto-learn, the crons, every embedding —
 * logged nothing, and they are where most of the Gemini bill goes.
 *
 * Every label here starts with `raw:` so Pulse, pulse-alert and the metrics
 * rollup (which exclude raw:* as per-attempt rows) keep reading chain outcomes
 * only. Failed attempts are logged too: a 429 or 503 used to fall through to
 * the next provider without a trace.
 *
 * Audio transcription is deliberately NOT logged here: Whisper bills per
 * second of audio, not per token, so estimateCost() would record 0 and make
 * a real cost look free. That needs its own pricing path.
 */
function logProviderCall({ route, business_id, stack, model, ok, t0, usage, error = null }) {
  const u = usage || {};
  const promptTokens = u.prompt_tokens || 0;
  const completionTokens = u.completion_tokens || 0;
  const cachedTokens = u.prompt_tokens_details?.cached_tokens ?? null;
  logCall({
    business_id: business_id || null,
    route: route ? `raw:${route}` : inferRoute(stack),
    model,
    ok,
    latency_ms: Date.now() - t0,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cached_tokens: cachedTokens,
    reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null,
    total_cost_usd: ok ? estimateCost(model, promptTokens, completionTokens, cachedTokens || 0) : 0,
    // Why it failed (status + message), so failures can be diagnosed after the
    // one-hour log retention: 55-70% of calls failed daily with no reason kept.
    ...(error ? { error } : {}),
  });
}

// ── Background pacing for Gemini ────────────────────────────────────────────
// Background work runs on Gemini only (see selectProviders). The nightly crons
// fired their calls back to back, so Gemini's free per-minute limit answered
// 429 to almost all of them: 134 of 134 owner_facts calls and 37 of 40
// auto_learn calls failed on 2026-10-31. Space background Gemini calls out per
// instance, and give a 429 one patient retry instead of dropping the work.
export const GEMINI_BG_GAP_MS = Number(process.env.AI_GEMINI_BG_GAP_MS || 7000);
export const GEMINI_BG_RETRY_MS = Number(process.env.AI_GEMINI_BG_RETRY_MS || 20000);
let geminiBgLast = 0;
let geminiBgQueue = Promise.resolve();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Resolves when this instance may make its next background Gemini call. */
export function waitForGeminiSlot(gap = GEMINI_BG_GAP_MS, now = () => Date.now(), wait = sleep) {
  const slot = geminiBgQueue.then(async () => {
    const left = geminiBgLast + gap - now();
    if (geminiBgLast && left > 0) await wait(left);
    geminiBgLast = now();
  });
  geminiBgQueue = slot.catch(() => {});
  return slot;
}
export function _resetGeminiPacing() { geminiBgLast = 0; geminiBgQueue = Promise.resolve(); }

const isRateLimit = (e) => Number(e?.status) === 429 || /\b429\b/.test(String(e?.message || ''));

// ── Images ──────────────────────────────────────────────────────────────────
// Photo calls (product image tags, photo understanding) fell through every
// provider at night: Groq's text model rejects image parts ("messages[1].content
// must be a string") and Ollama Cloud only takes base64 ("image URLs are not
// currently supported"). Skip text-only providers for image calls and inline
// the image for Ollama.
export function hasImageParts(messages) {
  return (messages || []).some(m => Array.isArray(m?.content) && m.content.some(p => p?.type === 'image_url'));
}

/** Providers that can't read images at all for this call. */
export function providerCantSeeImages(provider) {
  return !!provider?.name?.includes('Groq');
}

/** Replace http(s) image URLs with base64 data URIs (Ollama needs them). */
export async function inlineImageUrls(params, fetchImpl = fetch, maxBytes = 6 * 1024 * 1024) {
  if (!hasImageParts(params?.messages)) return params;
  const messages = [];
  for (const m of params.messages) {
    if (!Array.isArray(m?.content)) { messages.push(m); continue; }
    const content = [];
    for (const part of m.content) {
      const url = part?.type === 'image_url' ? (part.image_url?.url || part.image_url) : null;
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        const r = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`image fetch ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > maxBytes) throw new Error('image too large');
        const type = (r.headers?.get?.('content-type') || 'image/jpeg').split(';')[0];
        content.push({ ...part, image_url: { ...(typeof part.image_url === 'object' ? part.image_url : {}), url: `data:${type};base64,${buf.toString('base64')}` } });
      } else content.push(part);
    }
    messages.push({ ...m, content });
  }
  return { ...params, messages };
}

export function makeOpenAI() {
  const clients = getProviderClients();
  const primaryClient = clients[0]?.client || new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder',
  });

  return new Proxy(primaryClient, {
    get(target, prop, receiver) {
      if (prop === 'chat') {
        return {
          completions: {
            async create(params) {
              // route / business_id / conversation_id are OURS, not the API's.
              // sanitizeParams is a blacklist, so anything left in here would be
              // forwarded to the provider and 400 the request — strip them first.
              const { route, business_id, conversation_id, lane, ...callParams } = params;
              // Only pay for a stack walk when the caller didn't name itself.
              const stack = route ? null : new Error().stack;
              const callLane = laneFor(route, lane);
              const withImages = hasImageParts(callParams.messages);
              const chain = selectProviders(clients, { lane: callLane })
                .filter(p => !(withImages && providerCantSeeImages(p)));
              for (let i = 0; i < chain.length; i++) {
                const provider = chain[i];
                const isOllama = provider.name.includes('Ollama');
                const isGemini = provider.name.includes('Gemini');
                // Groq's OpenAI-compat layer 400s on `reasoning_effort` ("not supported
                // with this model") just like Gemini/Ollama — it was missing from this
                // check, so every brain-path call (which sets reasoning_effort) fell
                // through Groq unsanitized and got rejected before ever reaching Ollama.
                const isOpenAI = provider.name.includes('OpenAI');
                // The caller's requested model (params.model, e.g. "gpt-5.5" from
                // agentBrain.js) is an OpenAI model name. It must NOT be forwarded to
                // Groq/Gemini as-is — that's the "model gpt-5.5 does not exist" 404 seen
                // in prod logs for every Groq fallback attempt. Non-OpenAI providers use
                // their own configured defaultModel, exactly like loggedCompletion()
                // already does correctly in openai-wrapper.js.
                const targetModel = isOllama
                  ? (process.env.OLLAMA_MODEL || 'gemma3:4b')
                  : isOpenAI
                    ? normalizeModelName(callParams.model || provider.defaultModel || GPT_55, { fast: true })
                    // Tool-calling requests (the brain) get the provider's stronger
                    // toolModel when it has one; plain chat stays on the cheap default.
                    : ((callParams.tools?.length && provider.toolModel) || provider.defaultModel || GPT_55);
                let requestParams = withOllamaHeadroom(withGeminiThinking(sanitizeParams(callParams, !isOpenAI), provider.name), provider.name);
                if (isOpenAI) {
                  requestParams = sanitizeForRealOpenAI(requestParams, targetModel);
                }
                const paced = callLane === 'background' && isGemini;
                if (paced) await waitForGeminiSlot();
                let t0 = Date.now();
                try {
                  if (isOllama && withImages) requestParams = await inlineImageUrls(requestParams);
                  let res;
                  try {
                    res = await provider.client.chat.completions.create({ ...requestParams, model: targetModel });
                  } catch (e) {
                    if (!(paced && isRateLimit(e))) throw e;
                    logProviderCall({ route, business_id, stack, model: targetModel, ok: false, t0, usage: null,
                      error: `${e?.status || ''} ${String(e?.message || e)} (retrying)`.trim().slice(0, 300) });
                    await sleep(GEMINI_BG_RETRY_MS);
                    await waitForGeminiSlot();
                    t0 = Date.now();
                    res = await provider.client.chat.completions.create({ ...requestParams, model: targetModel });
                  }
                  logProviderCall({ route, business_id, stack, model: targetModel, ok: true, t0, usage: res?.usage });
                  return res;
                } catch (e) {
                  logProviderCall({ route, business_id, stack, model: targetModel, ok: false, t0, usage: null,
                    error: `${e?.status || e?.code || ''} ${String(e?.message || e)}`.trim().slice(0, 300) });
                  noteProviderFailure(provider, e);
                  console.warn(`[chat-fallback] ${provider.name} failed (${e.message}). Failing over...`);
                }
              }
              logProviderCall({ route, business_id, stack, model: 'chain-exhausted', ok: false, t0: Date.now(), usage: null });
              // The direct Ollama fetch is for a pool that left Ollama out. When
              // the chain already tried it, or it can't be reached, or this is
              // background work, repeating it only adds a failure.
              if (callLane === 'background' || chain.some(c => c.name.includes('Ollama')) || ollamaUnreachable()) {
                throw new Error(`All ${chain.length} LLM provider(s) failed (${callLane} lane)`);
              }
              return await fallbackOllamaFetch(callParams);
            },
          },
        };
      }

      if (prop === 'embeddings') {
        return {
          async create(params) {
            // Gemini-only. Every stored vector (products, businesses, document
            // chunks) is gemini-embedding-001 at 1536 dims since the 2026-10
            // re-embed; a fallback to any other provider would write or query
            // in a different vector space and silently return nonsense matches.
            const gemini = clients.find((c) => c.name.includes('Gemini'));
            if (gemini) {
              const inputs = Array.isArray(params.input) ? params.input : [params.input];
              const data = [];
              // The compat endpoint caps a batch at 100 inputs.
              for (let i = 0; i < inputs.length; i += 100) {
                const t0 = Date.now();
                let res;
                try {
                  res = await gemini.client.embeddings.create({
                    model: GEMINI_EMBED_MODEL,
                    dimensions: EMBED_DIMS,
                    input: inputs.slice(i, i + 100),
                  });
                } catch (e) {
                  logProviderCall({ route: 'embeddings', model: GEMINI_EMBED_MODEL, ok: false, t0, usage: null });
                  throw e;
                }
                logProviderCall({ route: 'embeddings', model: GEMINI_EMBED_MODEL, ok: true, t0, usage: res?.usage });
                for (const d of res.data) data.push({ ...d, index: data.length });
              }
              return { object: 'list', data, model: GEMINI_EMBED_MODEL };
            }
            for (let i = 0; i < clients.length; i++) {
              const provider = clients[i];
              try {
                const isOllama = provider.name.includes('Ollama');
                const model = isOllama ? (process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text') : (params.model || 'text-embedding-3-small');
                const res = await provider.client.embeddings.create({ ...params, model });
                return res;
              } catch (e) {
                console.warn(`[embeddings-fallback] ${provider.name} failed: ${e.message}`);
              }
            }
            // Every provider failed. This used to return a well-formed response
            // full of all-zero 1536-dim vectors — callers had no way to tell a
            // real embedding from a placeholder, so zero vectors got written
            // straight into businesses.search_embedding / document_chunks and
            // silently corrupted search relevance with no error anywhere.
            // Throwing lets callers skip the write and retry instead.
            throw new Error('All embedding providers failed');
          },
        };
      }

      if (prop === 'audio') {
        return {
          transcriptions: {
            async create(params) {
              for (let i = 0; i < clients.length; i++) {
                const provider = clients[i];
                try {
                  return await provider.client.audio.transcriptions.create(params);
                } catch (e) {
                  console.warn(`[audio-fallback] ${provider.name} failed: ${e.message}`);
                }
              }
              return { text: '' };
            },
          },
        };
      }

      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}
