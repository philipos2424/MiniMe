const OpenAI = require('openai');

const GPT_55_PRO = 'gpt-4o';
const GPT_55 = 'gpt-4o-mini';

function normalizeModelName(model, { fast = false } = {}) {
  const raw = `${model || ''}`.trim();
  if (!raw) return fast ? GPT_55 : GPT_55_PRO;

  const lower = raw.toLowerCase();
  if (lower.startsWith('gpt-4o')) return raw;
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

function sanitizeParams(params) {
  const clean = { ...params };
  delete clean.presence_penalty;
  delete clean.frequency_penalty;
  delete clean.user;
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
            const cleanParams = sanitizeParams(params);
            let lastErr = null;
            for (let i = 0; i < clients.length; i++) {
              const provider = clients[i];
              const isOllama = provider.name.includes('Ollama');
              const targetModel = isOllama
                ? (process.env.OLLAMA_MODEL || 'gemma3:4b')
                : normalizeModelName(cleanParams.model || provider.defaultModel || GPT_55, { fast: true });
              try {
                return await provider.client.chat.completions.create({
                  ...cleanParams,
                  model: targetModel,
                });
              } catch (e) {
                lastErr = e;
                console.warn(`[bot-ai-fallback] ${provider.name} failed (${e.message}). Failing over...`);
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
