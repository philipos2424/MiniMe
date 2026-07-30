import OpenAI from 'openai';

/**
 * Multi-Provider / Multi-Key Auto-Fallback Client Pool
 *
 * When an API key runs out of tokens, hits rate limits (429), or authentication errors (401/402),
 * MiniMe automatically fails over to the next configured provider in the list:
 *   1. Local Ollama (if USE_OLLAMA or OLLAMA_ENABLED is true)
 *   2. Primary OPENAI_API_KEY
 *   3. Backup BACKUP_OPENAI_API_KEY / OPENAI_API_KEY_2
 *   4. Free Google Gemini API (if GEMINI_API_KEY is configured)
 *   5. Local Ollama Fallback
 */
export function getProviderClients() {
  const clients = [];

  const useOllamaPrimary = process.env.USE_OLLAMA === 'true' || process.env.OLLAMA_ENABLED === 'true';
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
  const defaultOllamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';

  // 1. If Ollama is set as primary provider
  if (useOllamaPrimary) {
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

  // 2. Primary OpenAI API Key
  const primaryKey = process.env.OPENAI_API_KEY;
  if (primaryKey && primaryKey !== 'sk-placeholder') {
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

  // 3. Secondary / Backup Key
  const backupKey = process.env.BACKUP_OPENAI_API_KEY || process.env.OPENAI_API_KEY_2;
  if (backupKey) {
    clients.push({
      name: 'Backup API Key',
      client: new OpenAI({
        apiKey: backupKey,
        baseURL: process.env.BACKUP_OPENAI_BASE_URL || undefined,
        timeout: 45_000,
        maxRetries: 1,
      }),
    });
  }

  // 4. Free Google Gemini API Fallback
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

  // 5. Local Ollama Fallback (if not already added as primary)
  if (!useOllamaPrimary) {
    clients.push({
      name: 'Ollama (Local Fallback LLM)',
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
