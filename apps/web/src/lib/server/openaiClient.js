import OpenAI from 'openai';

/**
 * Universal OpenAI / Ollama Client Factory
 *
 * Provides single or multi-provider clients. When OpenAI hits 429 rate/quota limits
 * or when USE_OLLAMA=true is set, it routes calls locally to Ollama (http://127.0.0.1:11434/v1).
 */
export function getProviderClients() {
  const clients = [];

  const useOllamaPrimary = process.env.USE_OLLAMA === 'true' || process.env.OLLAMA_ENABLED === 'true' || (process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.includes('11434'));
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
  const defaultOllamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';

  // 1. Ollama Primary
  if (useOllamaPrimary || !process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'ollama') {
    clients.push({
      name: 'Ollama (Local Primary LLM)',
      client: new OpenAI({
        apiKey: 'ollama',
        baseURL: ollamaBaseUrl,
        timeout: 60_000,
        maxRetries: 0,
      }),
      defaultModel: defaultOllamaModel,
    });
  }

  // 2. Primary OpenAI API Key (if provided and valid)
  const primaryKey = process.env.OPENAI_API_KEY;
  if (primaryKey && primaryKey !== 'sk-placeholder' && primaryKey !== 'ollama') {
    clients.push({
      name: 'Primary API Key',
      client: new OpenAI({
        apiKey: primaryKey,
        baseURL: process.env.OPENAI_BASE_URL && !process.env.OPENAI_BASE_URL.includes('11434') ? process.env.OPENAI_BASE_URL : undefined,
        timeout: 45_000,
        maxRetries: 1,
      }),
    });
  }

  // 3. Free Google Gemini API Fallback
  if (process.env.GEMINI_API_KEY) {
    clients.push({
      name: 'Google Gemini (Free API)',
      client: new OpenAI({
        apiKey: process.env.GEMINI_API_KEY,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        timeout: 45_000,
        maxRetries: 1,
      }),
      defaultModel: 'gemini-2.0-flash',
    });
  }

  // 4. Fallback Ollama Client
  if (clients.length === 0) {
    clients.push({
      name: 'Ollama (Fallback LLM)',
      client: new OpenAI({
        apiKey: 'ollama',
        baseURL: ollamaBaseUrl,
        timeout: 60_000,
        maxRetries: 0,
      }),
      defaultModel: defaultOllamaModel,
    });
  }

  return clients;
}

export function makeOpenAI(opts = {}) {
  const clients = getProviderClients();
  return clients[0].client;
}
