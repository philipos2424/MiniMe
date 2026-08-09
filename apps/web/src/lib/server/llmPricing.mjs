/**
 * LLM token pricing — what a call costs us, in USD.
 *
 * Split out of openai-wrapper.js and kept dependency-free on purpose (same
 * reasoning as fetch-all.mjs): the wrapper imports the Supabase client, which
 * plain `node --test` can't resolve, and this is the logic that most needs
 * tests. estimateCost feeds the admin cost dashboards AND
 * deductCreditAndLogUsage, which debits a merchant's credit balance — a wrong
 * rate here takes real money from customers, it doesn't just misreport.
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
};

/**
 * Fallback-provider models we pay nothing for (Groq and Gemini free tiers,
 * local Ollama). These MUST be priced at zero rather than falling through to
 * the flagship default: an OpenAI outage routes every call here, and the cost
 * is passed to deductCreditAndLogUsage — so the outage was silently debiting
 * merchant credit balances at gpt-5.5-pro rates for calls that cost us nothing.
 * Keep in sync with getProviderClients() in openaiClient.js.
 */
export const FREE_MODELS = new Set([
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
]);

// Ollama runs locally and is free whatever the tag (llama3.2, qwen2.5:7b, …).
const LOCAL_MODEL_RE = /^(llama|qwen|mistral|phi|gemma|deepseek)/i;

const DEFAULT_MODEL = 'gpt-5.5-pro';

// Warn once per unknown model rather than on every call.
const _warned = new Set();

/** Resolve the price row for a model, or null when we genuinely don't know it. */
export function priceFor(model) {
  if (!model) return null;
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
