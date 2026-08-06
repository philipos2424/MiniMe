import OpenAI from 'openai/index.js';

const GPT_56_SOL = 'gpt-5.6-sol';
const GPT_56_TERRA = 'gpt-5.6-terra';

export function normalizeModelName(model, { fast = false } = {}) {
  const raw = `${model || ''}`.trim();
  if (!raw) return fast ? GPT_56_TERRA : GPT_56_SOL;

  const lower = raw.toLowerCase();
  if (lower.startsWith('gpt-5.6')) return raw;
  if (lower.includes('mini') || lower.includes('nano') || lower.includes('fast')) return GPT_56_TERRA;
  if (lower.includes('gpt-5.5') || lower.includes('gpt-4.1') || lower.includes('gpt-4o')) return GPT_56_SOL;
  if (lower.includes('llama') || lower.includes('gemma') || lower.includes('gemini')) {
    return fast ? GPT_56_TERRA : GPT_56_SOL;
  }
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
function sanitizeParams(params, isGeminiOrOllama = true) {
  const clean = { ...params };
  if (isGeminiOrOllama) {
    delete clean.presence_penalty;
    delete clean.frequency_penalty;
    delete clean.user;
  }
  return clean;
}

async function fallbackOllamaFetch(params) {
  const model = process.env.OLLAMA_MODEL || 'gemma3:4b';
  const url = `${process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1'}`
    .replace('localhost', '127.0.0.1')
    .replace(/\/+$/, '') + '/chat/completions';
  const body = sanitizeParams({
    model,
    messages: params.messages || [],
    temperature: params.temperature,
    max_tokens: params.max_tokens,
    response_format: params.response_format,
  }, true);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`Ollama HTTP error ${resp.status}`);
    }
    return await resp.json();
  } catch (e) {
    console.warn('[Ollama Fetch Fallback]', e.message);
    const isJson = params.response_format?.type === 'json_object';
    return {
      id: 'chatcmpl-fallback-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: isJson ? '{}' : 'Hello! How can I assist your business today?',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
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

  if (!preferOllama) {
    clients.push(ollamaProvider);
  } else {
    clients.unshift(ollamaProvider);
  }

  return clients;
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
              for (let i = 0; i < clients.length; i++) {
                const provider = clients[i];
                const isOllama = provider.name.includes('Ollama');
                const isGemini = provider.name.includes('Gemini');
                const targetModel = isOllama
                  ? (process.env.OLLAMA_MODEL || 'gemma3:4b')
                  : normalizeModelName(params.model || provider.defaultModel || GPT_56_TERRA, { fast: true });
                const requestParams = sanitizeParams(params, isGemini || isOllama);
                try {
                  const res = await provider.client.chat.completions.create({
                    ...requestParams,
                    model: targetModel,
                  });
                  return res;
                } catch (e) {
                  console.warn(`[chat-fallback] ${provider.name} failed (${e.message}). Failing over...`);
                }
              }
              return await fallbackOllamaFetch(params);
            },
          },
        };
      }

      if (prop === 'embeddings') {
        return {
          async create(params) {
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
