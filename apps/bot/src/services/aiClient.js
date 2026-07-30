const OpenAI = require('openai');

/**
 * Shared AI Client Pool & Proxy for Telegram Bot Services.
 *
 * Automatically routes to:
 *   1. Groq Cloud API (GROQ_API_KEY) — Llama 3.1 8B Instant (Primary)
 *   2. Google Gemini API (GEMINI_API_KEY) — Gemini 2.5 Flash
 *   3. Local Ollama (http://127.0.0.1:11434/v1)
 *
 * Sanitizes parameters so penalty options never crash non-OpenAI endpoints.
 */
function getBotProviderClients() {
  const clients = [];

  // 1. Groq Ultra-Fast API (Primary)
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

  // 2. Google Gemini 2.5 Flash API
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

  // 3. Local Ollama Fallback
  const rawOllamaUrl = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
  const ollamaBaseUrl = rawOllamaUrl.replace('localhost', '127.0.0.1').replace(/\/+$/, '');
  clients.push({
    name: 'Ollama (Local LLM)',
    client: new OpenAI({
      apiKey: 'ollama',
      baseURL: ollamaBaseUrl,
      timeout: 60_000,
      maxRetries: 0,
    }),
    defaultModel: process.env.OLLAMA_MODEL || 'qwen2.5:0.5b',
  });

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
              const targetModel = provider.defaultModel || 'llama-3.1-8b-instant';
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
  return clients[0]?.defaultModel || 'llama-3.1-8b-instant';
}

module.exports = {
  openai: botOpenAI,
  resolveModel,
  useOllama: false,
};
