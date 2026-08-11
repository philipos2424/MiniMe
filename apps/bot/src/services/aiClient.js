const OpenAI = require('openai');

const GPT_55 = 'gpt-5.5';
// "gpt-5.5-pro" IS listed by /v1/models, but it is not a chat model — calling it
// on /v1/chat/completions returns 404 "This is not a chat model and thus not
// supported in the v1/chat/completions endpoint". Verified against the live API.
// So every "pro" chat request routes to gpt-5.5 until a real pro chat tier ships.
const GPT_55_PRO = 'gpt-5.5';

function normalizeModelName(model, { fast = false } = {}) {
  const raw = `${model || ''}`.trim();
  if (!raw) return fast ? GPT_55 : GPT_55_PRO;

  const lower = raw.toLowerCase();
  // Catch *-pro before the passthrough below, or it 404s on chat.completions.
  if (/-pro\b/.test(lower)) return GPT_55_PRO;
  if (lower.startsWith('gpt-5.5')) return raw;
  if (lower.includes('mini') || lower.includes('nano') || lower.includes('fast')) return GPT_55;
  if (lower.includes('gpt-5.6') || lower.includes('gpt-4.1') || lower.includes('gpt-4o')) return GPT_55_PRO;
  if (lower.includes('llama') || lower.includes('gemma') || lower.includes('gemini')) {
    return fast ? GPT_55 : GPT_55_PRO;
  }
  return raw;
}

/**
 * Shared AI Client Pool & Proxy for Telegram Bot Services.
 *
 * GPT is the default path when an OpenAI key exists.
 * Groq, Gemini, and Ollama remain as explicit backups.
 */
function prefersOllama() {
  return process.env.USE_OLLAMA === 'true'
    || process.env.OLLAMA_ENABLED === 'true'
    || process.env.OPENAI_API_KEY === 'ollama'
    || !!(process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.includes('11434'));
}

function getBotProviderClients() {
  const clients = [];
  const preferOllama = prefersOllama();

  const primaryKey = process.env.OPENAI_API_KEY;
  if (primaryKey && primaryKey !== 'sk-placeholder' && primaryKey !== 'ollama') {
    clients.push({
      name: 'OpenAI (Primary API Key)',
      client: new OpenAI({
        apiKey: primaryKey,
        baseURL: process.env.OPENAI_BASE_URL && !process.env.OPENAI_BASE_URL.includes('11434')
          ? process.env.OPENAI_BASE_URL.replace(/\/+$/, '')
          : undefined,
        timeout: 45_000,
        maxRetries: 1,
      }),
    });
  }

  if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'sk-placeholder') {
    clients.push({
      name: 'Groq (Ultra-Fast API)',
      client: new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
        timeout: 30_000,
        maxRetries: 1,
      }),
      defaultModel: 'llama-3.1-8b-instant',
    });
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'sk-placeholder') {
    clients.push({
      name: 'Google Gemini (Free API)',
      client: new OpenAI({
        apiKey: process.env.GEMINI_API_KEY,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        timeout: 45_000,
        maxRetries: 1,
      }),
      defaultModel: 'gemini-2.5-flash',
    });
  }

  const rawOllamaUrl = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
  const ollamaBaseUrl = rawOllamaUrl.replace('localhost', '127.0.0.1').replace(/\/+$/, '');
  const ollamaProvider = {
    name: 'Ollama (Local LLM)',
    client: new OpenAI({
      apiKey: process.env.OLLAMA_API_KEY || 'ollama',
      baseURL: ollamaBaseUrl,
      timeout: 60_000,
      maxRetries: 0,
    }),
    defaultModel: process.env.OLLAMA_MODEL || 'gemma3:4b',
  };

  if (!preferOllama) {
    clients.push(ollamaProvider);
  } else {
    clients.unshift(ollamaProvider);
  }

  return clients;
}

// Strip params that Gemini/Ollama's OpenAI-compat endpoints reject with 400.
function sanitizeParams(params, isGeminiOrOllama = true) {
  const clean = { ...params };
  if (isGeminiOrOllama) {
    delete clean.presence_penalty;
    delete clean.frequency_penalty;
    delete clean.user;
  }
  return clean;
}

// gpt-5.x rejects `max_tokens` on /v1/chat/completions ("Unsupported parameter")
// and rejects any non-default sampling params. Every call site in this app was
// written for gpt-4o and passes `max_tokens` + `temperature`, so without this
// translation EVERY OpenAI request 400s and the bot silently degrades to the
// local Ollama fallback. Mirrors sanitizeForRealOpenAI() in
// apps/web/src/lib/server/openaiClient.js — keep the two in sync.
function sanitizeForRealOpenAI(params, model) {
  const clean = { ...params };
  if (/^gpt-5/.test(model || '')) {
    if (clean.max_tokens !== undefined && clean.max_completion_tokens === undefined) {
      clean.max_completion_tokens = clean.max_tokens;
      delete clean.max_tokens;
    }
    // gpt-5.x spends part of the budget on hidden reasoning tokens before the
    // visible reply. Call sites here pass 150–400, which can be consumed
    // entirely by reasoning and return an empty completion. Floor it.
    if (clean.max_completion_tokens !== undefined && clean.max_completion_tokens < 2000) {
      clean.max_completion_tokens = 2000;
    }
    delete clean.temperature;
    delete clean.top_p;
    delete clean.presence_penalty;
    delete clean.frequency_penalty;
    delete clean.logprobs;
    delete clean.top_logprobs;
  }
  return clean;
}

const clients = getBotProviderClients();
const primaryClient = clients[0].client;

const botOpenAI = new Proxy(primaryClient, {
  get(target, prop, receiver) {
    if (prop === 'chat') {
      return {
        completions: {
          async create(params) {
            let lastErr = null;
            for (let i = 0; i < clients.length; i++) {
              const provider = clients[i];
              const isOllama = provider.name.includes('Ollama');
              const isGemini = provider.name.includes('Gemini');
              const isOpenAI = provider.name.includes('OpenAI');

              // Only OpenAI understands our gpt-5.x names. Groq and Gemini must
              // be given THEIR own model or they 404 — which is what silently
              // killed both fallback tiers and left Ollama as the only path.
              const targetModel = isOllama
                ? (process.env.OLLAMA_MODEL || 'gemma3:4b')
                : isOpenAI
                  ? normalizeModelName(params.model || GPT_55, { fast: true })
                  : (provider.defaultModel || normalizeModelName(params.model || GPT_55, { fast: true }));

              let requestParams = sanitizeParams(params, isGemini || isOllama);
              if (isOpenAI) requestParams = sanitizeForRealOpenAI(requestParams, targetModel);

              try {
                return await provider.client.chat.completions.create({
                  ...requestParams,
                  model: targetModel,
                });
              } catch (e) {
                lastErr = e;
                console.warn(`[bot-ai-fallback] ${provider.name} (${targetModel}) failed (${e.message}). Failing over...`);
              }
            }
            throw lastErr || new Error('All bot AI providers failed');
          },
        },
      };
    }
    const val = Reflect.get(target, prop, receiver);
    return typeof val === 'function' ? val.bind(target) : val;
  },
});

function resolveModel(requestedModel) {
  return normalizeModelName(requestedModel, { fast: !requestedModel || `${requestedModel}`.includes('mini') });
}

module.exports = {
  openai: botOpenAI,
  resolveModel,
  useOllama: prefersOllama(),
};
