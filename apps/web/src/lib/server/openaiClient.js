import OpenAI from 'openai';

/**
 * Multi-Provider / Multi-Key Auto-Fallback Client Pool
 *
 * When an API key runs out of tokens, hits rate limits (429), or authentication errors (401/402),
 * MiniMe automatically fails over to the next configured provider in the list:
 *   1. Primary OPENAI_API_KEY
 *   2. Backup BACKUP_OPENAI_API_KEY / OPENAI_API_KEY_2
 *   3. Free Google Gemini API (if GEMINI_API_KEY is configured)
 *   4. Local Ollama (if OLLAMA_BASE_URL or OLLAMA_ENABLED is set)
 */
export function getProviderClients() {
  const clients = [];

  // 1. Primary API Key
  const primaryKey = process.env.OPENAI_API_KEY;
  if (primaryKey) {
    clients.push({
      name: 'Primary API Key',
      client: new OpenAI({
        apiKey: primaryKey,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
        timeout: 45_000,
        maxRetries: 1,
      }),
    });
  }

  // 2. Secondary / Backup Key
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

  // 4. Local Ollama Fallback
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_ENABLED === 'true') {
    clients.push({
      name: 'Ollama (Local Free LLM)',
      client: new OpenAI({
        apiKey: 'ollama',
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
        timeout: 60_000,
        maxRetries: 0,
      }),
      defaultModel: 'qwen2.5',
    });
  }

  // Fallback default if nothing else is specified
  if (clients.length === 0) {
    clients.push({
      name: 'Default Client',
      client: new OpenAI({
        apiKey: 'sk-placeholder',
        timeout: 45_000,
        maxRetries: 1,
      }),
    });
  }

  return clients;
}

export function makeOpenAI(opts = {}) {
  const clients = getProviderClients();
  return clients[0].client;
}


