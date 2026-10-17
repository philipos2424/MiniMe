/**
 * LLM token pricing — what a call costs us, in USD.
 *
 * Split out of openai-wrapper.js and kept dependency-free on purpose (same
 * reasoning as fetch-all.mjs): the wrapper imports the Supabase client, which
 * plain `node --test` can't resolve, and this is the logic that most needs
 * tests. estimateCost feeds llm_call_log.total_cost_usd and ai_usage.cost_estimate,
 * which drive the admin cost, economics and Pulse dashboards. It no longer moves
 * merchant money: deductCreditAndLogUsage debits credits by token count
 * (creditsForTokens), and only records this estimate.
 *
 * Rates are per 1M tokens.
 *
 * `cached` is the discounted rate for prompt tokens served from the prefix
 * cache. Ignoring it overstates the cost of exactly the prompts we reordered to
 * be cacheable, which would make the fix look like it did nothing.
 *
 * Embeddings and audio were previously absent entirely, so every embedding
 * backfill and voice transcription in the app costed as $0 — which is why they
 * looked free in the dashboards. They are not free at 9k+ document chunks.
 */
export const PRICING = {
  'gpt-5.5-pro':   { in: 5.00,  cached: 0.50,  out: 30.00 },
  'gpt-5.5':       { in: 5.00,  cached: 0.50,  out: 30.00 },
  'gpt-5.4-pro':   { in: 5.00,  cached: 0.50,  out: 30.00 },
  'gpt-5.4-mini':  { in: 0.75,  cached: 0.075, out: 3.00 },
  'gpt-5.4-nano':  { in: 0.15,  cached: 0.015, out: 0.60 },
  // The 4.x models carry most real traffic (onboarding interviews, replies,
  // photo descriptions, summaries) and were all missing — so they fell through
  // to the flagship default below and were costed at up to 13x their real rate.
  // List prices; re-check against platform.openai.com/pricing when they move.
  'gpt-4.1':       { in: 2.00,  cached: 0.50,  out: 8.00 },
  'gpt-4.1-mini':  { in: 0.40,  cached: 0.10,  out: 1.60 },
  'gpt-4.1-nano':  { in: 0.10,  cached: 0.025, out: 0.40 },
  'gpt-4o':        { in: 2.50,  cached: 1.25,  out: 10.00 },
  'gpt-4o-mini':   { in: 0.15,  cached: 0.075, out: 0.60 },
  'text-embedding-3-small': { in: 0.02, cached: 0.02, out: 0 },
  'text-embedding-3-large': { in: 0.13, cached: 0.13, out: 0 },
  'whisper-1':     { in: 0,     cached: 0,     out: 0 },  // billed per minute, not per token
  // Gemini is the primary provider on a PAID key (since 2026-10-08) — it was
  // listed as free here, so every dashboard showed ~$0 AI cost while Google
  // billed real money. Paid-tier list prices, ai.google.dev/gemini-api/docs/pricing
  // (checked 2026-10-17). gemini-3.5-flash isn't priced on its own: per the
  // deprecations page its endpoint routes to gemini-3.6-flash, so it bills as 3.6.
  'gemini-2.5-flash': { in: 0.30, cached: 0.03, out: 2.50 },
};

// Gemini 3.6 Flash list price doubles on 2027-01-01 (00:00 UTC, per the pricing page).
const GEMINI_FLASH_PRICE_CHANGE = Date.UTC(2027, 0, 1);
const GEMINI_FLASH_2026 = { in: 0.75, cached: 0.075, out: 3.75 };
const GEMINI_FLASH_2027 = { in: 1.50, cached: 0.15,  out: 7.50 };
const GEMINI_FLASH_MODELS = new Set(['gemini-3.5-flash', 'gemini-3.6-flash']);

/**
 * Models we pay nothing for (Groq's free tier, local Ollama). These MUST be
 * priced at zero rather than falling through to the flagship default, or an
 * outage that routes calls here reports flagship spend for free calls.
 * Gemini is NOT here: the key is paid. Keep in sync with getProviderClients()
 * in openaiClient.js.
 */
export const FREE_MODELS = new Set([
  'llama-3.1-8b-instant',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
]);

// Ollama runs locally and is free whatever the tag (llama3.2, qwen2.5:7b, …).
const LOCAL_MODEL_RE = /^(llama|qwen|mistral|phi|gemma|deepseek)/i;

const DEFAULT_MODEL = 'gpt-5.5-pro';

// Warn once per unknown model rather than on every call.
const _warned = new Set();

/** Resolve the price row for a model, or null when we genuinely don't know it. */
export function priceFor(model, at = Date.now()) {
  if (!model) return null;
  if (GEMINI_FLASH_MODELS.has(model)) return at >= GEMINI_FLASH_PRICE_CHANGE ? GEMINI_FLASH_2027 : GEMINI_FLASH_2026;
  if (PRICING[model]) return PRICING[model];
  if (FREE_MODELS.has(model) || LOCAL_MODEL_RE.test(model)) return { in: 0, cached: 0, out: 0 };
  return null;
}

/**
 * Estimate USD cost. `cachedTokens` is a SUBSET of promptTokens — the cached
 * portion is billed at the discounted rate and the remainder at full rate.
 * Reasoning tokens are already included in completionTokens by the API, so they
 * must not be added again here.
 *
 * An unknown model still falls back to flagship rates, deliberately: silently
 * pricing it at zero would hide real spend, and under-reporting our own cost is
 * the more dangerous error at this size. The warning names the model so it gets
 * added above instead of quietly over-charging forever.
 */
export function estimateCost(model, promptTokens, completionTokens, cachedTokens = 0) {
  let p = priceFor(model);
  if (!p) {
    if (model && !_warned.has(model)) {
      _warned.add(model);
      console.warn(`[pricing] no rate for model "${model}" — charging flagship rates. Add it to PRICING in llmPricing.mjs.`);
    }
    p = PRICING[DEFAULT_MODEL];
  }
  const prompt = promptTokens || 0;
  const cached = Math.min(cachedTokens || 0, prompt);
  const uncached = prompt - cached;
  return (uncached * p.in + cached * p.cached + (completionTokens || 0) * p.out) / 1_000_000;
}
