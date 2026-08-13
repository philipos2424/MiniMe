import OpenAI from 'openai/index.js';

const GPT_55 = 'gpt-5.5';
// "gpt-5.5-pro" IS listed by /v1/models, but it is NOT a chat model — calling it
// on /v1/chat/completions returns 404 "This is not a chat model and thus not
// supported in the v1/chat/completions endpoint". Verified against the live API.
// This previously resolved to the literal 'gpt-5.5-pro', so every call site
// passing a non-mini legacy name (b2b.js and research.js pass 'gpt-4.1') 404'd
// on OpenAI, fell through Groq and Gemini, and landed on fallbackOllamaFetch —
// which returns a canned "Hi! How can I help?" instead of a real answer.
// 
// VALID MODELS (as of 2026-08): gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, o1-preview, o1-mini
// gpt-5.x models are NOT yet available on chat.completions endpoint.
const GPT_55_PRO = 'gpt-4.1'; // Default to actual available model

export function normalizeModelName(model, { fast = false } = {}) {
  const raw = `${model || ''}`.trim();
  if (!raw) return fast ? GPT_55 : GPT_55_PRO;

  const lower = raw.toLowerCase();
  // Catch *-pro before the gpt-5.5 passthrough, or it 404s on chat.completions.
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
 * Universal Multi-Provider AI Client Pool & Infallible Proxy Wrapper
 *
 * GPT is the default path when an OpenAI key is present.
 * Groq, Gemini, and Ollama remain as explicit backups.
 *
 * Auto-sanitizes params (e.g. strips presence_penalty / frequency_penalty)
 * so non-OpenAI endpoints never reject requests with INVALID_ARGUMENT (400).
 */
export function sanitizeParams(params, isGeminiOrOllama = true) {
  const clean = { ...params };
  if (isGeminiOrOllama) {
    delete clean.presence_penalty;
    delete clean.frequency_penalty;
    delete clean.user;
    // OpenAI-only knob — Gemini's compat layer and Ollama reject it.
    delete clean.reasoning_effort;
  }
  return clean;
}

// The lowest reasoning setting gpt-5.5 accepts. 'minimal' is NOT valid on this
// model — it 400s with "Supported values are: 'none', 'low', 'medium', 'high',
// and 'xhigh'". Verified against the live API.
const NO_REASONING = 'none';

// Absolute floor for max_completion_tokens. With reasoning disabled a YES/NO
// answer costs ~4 tokens, so this is headroom, not a budget.
const MIN_COMPLETION_TOKENS = 16;

// gpt-5.x rejects `max_tokens` on /v1/chat/completions ("Unsupported parameter") —
// it wants `max_completion_tokens` instead. Translate transparently so none of the
// ~30 call sites across the codebase need to change.
export function sanitizeForRealOpenAI(params, model) {
  const clean = { ...params };
  if (/^gpt-5/.test(model || '')) {
    if (clean.max_tokens !== undefined && clean.max_completion_tokens === undefined) {
      clean.max_completion_tokens = clean.max_tokens;
      delete clean.max_tokens;
    }

    // gpt-5.x spends part of the budget on hidden reasoning tokens BEFORE the
    // visible reply, so a low cap (call sites here were written for gpt-4o and
    // pass 150-900) could exhaust the whole budget on reasoning and return an
    // empty completion — measured: cap=24 with reasoning on returns "" with
    // finish_reason 'length'.
    //
    // This used to be handled by flooring every cap up to 2000, which fixed the
    // symptom by letting reasoning run unconstrained on every call in the app.
    // Disabling reasoning fixes the cause: the same call returns "NO" in 4
    // tokens with 0 reasoning tokens. Callers that genuinely need reasoning
    // (tool-calling loops) pass reasoning_effort explicitly and keep their cap.
    if (clean.reasoning_effort === undefined) {
      clean.reasoning_effort = NO_REASONING;
    }
    if (clean.reasoning_effort !== NO_REASONING) {
      // Reasoning is on by explicit request — restore the old headroom so it
      // can't starve the visible answer.
      if (clean.max_completion_tokens !== undefined && clean.max_completion_tokens < 2000) {
        clean.max_completion_tokens = 2000;
      }
    } else if (clean.max_completion_tokens !== undefined) {
      clean.max_completion_tokens = Math.max(clean.max_completion_tokens, MIN_COMPLETION_TOKENS);
    }

    // gpt-5.x only supports default sampling params — custom values 400.
    delete clean.temperature;
    delete clean.top_p;
    delete clean.presence_penalty;
    delete clean.frequency_penalty;
    delete clean.logprobs;
    delete clean.top_logprobs;
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

  const lastUserMessage = [...(params.messages || [])].reverse().find((msg) => msg?.role === 'user')?.content || '';
  const normalized = `${lastUserMessage}`.trim().toLowerCase();
  const tinyReply = (() => {
    if (/^(hi+|hello+|hey+|hii+|good morning|good afternoon|good evening|selam|ሰላም|salam)\b/.test(normalized)) {
      return 'Hi! How can I help?';
    }
    if (/^(what|what\?|huh|eh|sorry\??|pardon\??)\b/.test(normalized)) {
      return 'Sure, what do you mean?';
    }
    return null;
  })();

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
            content: isJson ? '{}' : (tinyReply || 'Hi! How can I help?'),
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
      // llama-3.1-8b-instant is on Groq's deprecation list (console.groq.com/docs/deprecations)
      // but is still the fastest/cheapest option and reliable for plain chat (fast_reply,
      // greeting shortcuts) — keep it as the default for everything that isn't tool-calling.
      defaultModel: 'llama-3.1-8b-instant',
      // agentBrain.js / teamBrain.js pass `tools` + `reasoning_effort` — this is where
      // llama-3.1-8b-instant fails in practice: it hallucinates tool names outside the
      // schema (verified: "attempted to call tool 'delegate' which was not in
      // request.tools" on a plain "how do I delegate" message). gpt-oss-120b handled the
      // same tool-calling prompts correctly at the real 2000-token budget the brain uses.
      // Reserved for tool-calling calls only — it eats far more of Groq's free 8k TPM
      // budget than the 8b model, so using it for every message would burn the quota fast.
      toolModel: 'openai/gpt-oss-120b',
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
      // Pro models left Gemini's free tier in April 2026 — Flash is the smartest
      // model still available on a free key. gemini-2.5-flash is prior-gen now.
      defaultModel: 'gemini-3.5-flash',
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
                // Groq's OpenAI-compat layer 400s on `reasoning_effort` ("not supported
                // with this model") just like Gemini/Ollama — it was missing from this
                // check, so every brain-path call (which sets reasoning_effort) fell
                // through Groq unsanitized and got rejected before ever reaching Ollama.
                const isOpenAI = provider.name.includes('OpenAI');
                // The caller's requested model (params.model, e.g. "gpt-5.5" from
                // agentBrain.js) is an OpenAI model name. It must NOT be forwarded to
                // Groq/Gemini as-is — that's the "model gpt-5.5 does not exist" 404 seen
                // in prod logs for every Groq fallback attempt. Non-OpenAI providers use
                // their own configured defaultModel, exactly like loggedCompletion()
                // already does correctly in openai-wrapper.js.
                const targetModel = isOllama
                  ? (process.env.OLLAMA_MODEL || 'gemma3:4b')
                  : isOpenAI
                    ? normalizeModelName(params.model || provider.defaultModel || GPT_55, { fast: true })
                    // Tool-calling requests (the brain) get the provider's stronger
                    // toolModel when it has one; plain chat stays on the cheap default.
                    : ((params.tools?.length && provider.toolModel) || provider.defaultModel || GPT_55);
                let requestParams = sanitizeParams(params, !isOpenAI);
                if (isOpenAI) {
                  requestParams = sanitizeForRealOpenAI(requestParams, targetModel);
                }
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
