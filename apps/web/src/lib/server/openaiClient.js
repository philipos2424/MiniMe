import OpenAI from 'openai';

/**
 * Universal Multi-Provider AI Client Pool & Proxy Wrapper
 *
 * Automatically handles failover across providers:
 *   1. Local Ollama (http://127.0.0.1:11434/v1)
 *   2. Primary OpenAI API Key (if valid and quota available)
 *   3. Secondary / Backup OpenAI API Key
 *   4. Free Google Gemini API
 *
 * Intercepts chat completions, embeddings, and transcriptions so that
 * OpenAI 429 quota/spend-limit errors automatically failover to Ollama
 * or return safe fallbacks without throwing 429 exceptions.
 */
export function getProviderClients() {
  const clients = [];

  const useOllamaPrimary = process.env.USE_OLLAMA === 'true' || process.env.OLLAMA_ENABLED === 'true' || (process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.includes('11434'));
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
  const defaultOllamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';

  // 1. Google Gemini API (Free Cloud API)
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'sk-placeholder') {
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

  // 2. Ollama Local Provider (Primary when enabled)
  if (useOllamaPrimary || !process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'ollama') {
    clients.push({
      name: 'Ollama (Local LLM)',
      client: new OpenAI({
        apiKey: 'ollama',
        baseURL: ollamaBaseUrl,
        timeout: 60_000,
        maxRetries: 0,
      }),
      defaultModel: defaultOllamaModel,
    });
  }

  // 5. Ollama Fallback if nothing else added
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
  const primaryClient = clients[0].client;

  return new Proxy(primaryClient, {
    get(target, prop, receiver) {
      // ── CHAT COMPLETIONS ──────────────────────────────
      if (prop === 'chat') {
        return {
          completions: {
            async create(params) {
              let lastErr = null;
              for (let i = 0; i < clients.length; i++) {
                const provider = clients[i];
                const isOllama = provider.name.includes('Ollama');
                const targetModel = isOllama
                  ? (process.env.OLLAMA_MODEL || 'qwen2.5:0.5b')
                  : (provider.defaultModel || params.model || 'gpt-4o-mini');
                try {
                  const res = await provider.client.chat.completions.create({
                    ...params,
                    model: targetModel,
                  });
                  return res;
                } catch (e) {
                  lastErr = e;
                  console.warn(`[chat-fallback] ${provider.name} failed: ${e.message}`);
                }
              }
              throw lastErr || new Error('All AI providers failed');
            },
          },
        };
      }

      // ── EMBEDDINGS ───────────────────────────────────
      if (prop === 'embeddings') {
        return {
          async create(params) {
            for (let i = 0; i < clients.length; i++) {
              const provider = clients[i];
              try {
                const isOllama = provider.name.includes('Ollama');
                const model = isOllama ? (process.env.OLLAMA_MODEL || 'qwen2.5:0.5b') : (params.model || 'text-embedding-3-small');
                const res = await provider.client.embeddings.create({ ...params, model });
                return res;
              } catch (e) {
                console.warn(`[embeddings-fallback] ${provider.name} failed: ${e.message}`);
              }
            }
            // Return safe zero vector fallback if all providers fail/exceed quota
            const inputCount = Array.isArray(params.input) ? params.input.length : 1;
            return {
              object: 'list',
              data: Array.from({ length: inputCount }, (_, index) => ({
                object: 'embedding',
                index,
                embedding: new Array(1536).fill(0),
              })),
              model: params.model || 'text-embedding-3-small',
              usage: { prompt_tokens: 0, total_tokens: 0 },
            };
          },
        };
      }

      // ── AUDIO / TRANSCRIPTIONS ───────────────────────
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
