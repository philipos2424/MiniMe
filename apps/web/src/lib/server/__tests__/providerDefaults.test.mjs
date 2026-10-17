import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GROQ_API_KEY = 'test-key';
const { getProviderClients } = await import('../openaiClient.js');
const { FREE_MODELS, estimateCost } = await import('../llmPricing.mjs');

const groq = () => getProviderClients().find(c => c.name.includes('Groq'));

test('Groq never defaults to a model Groq has retired', () => {
  // llama-3.1-8b-instant was retired 2026-08-16: as the default it made every
  // Groq fallback for plain chat fail, so a Gemini error had no backup.
  assert.notEqual(groq().defaultModel, 'llama-3.1-8b-instant');
});

test('every Groq model the chain can pick is priced as free', () => {
  // FREE_MODELS also gates merchant credit deductions: a model missing from it
  // is billed at flagship rates for calls that cost nothing.
  for (const model of [groq().defaultModel, groq().toolModel]) {
    assert.ok(FREE_MODELS.has(model), `${model} must be in FREE_MODELS`);
    assert.equal(estimateCost(model, 1000, 1000), 0);
  }
});

test('Gemini embeddings are priced, not charged at the unknown-model rate', () => {
  // Paid key: $0.15 per 1M input tokens, not the flagship fallback.
  assert.equal(estimateCost('gemini-embedding-001', 1_000_000, 0), 0.15);
});

test('Ollama Cloud models are priced as free', () => {
  assert.equal(estimateCost('gemma4:31b', 1000, 1000), 0);
});

test('Ollama Cloud gets token headroom for thinking; local Ollama keeps the cap', async () => {
  const { withOllamaHeadroom } = await import('../openaiClient.js');
  delete process.env.OLLAMA_API_KEY;
  assert.equal(withOllamaHeadroom({ max_tokens: 5 }, 'Ollama (Local LLM)').max_tokens, 5);
  process.env.OLLAMA_API_KEY = 'test';
  assert.equal(withOllamaHeadroom({ max_tokens: 5 }, 'Ollama (Local LLM)').max_tokens, 1024);
  assert.equal(withOllamaHeadroom({ max_tokens: 2000 }, 'Ollama (Local LLM)').max_tokens, 2000);
  assert.equal(withOllamaHeadroom({ max_tokens: 5 }, 'Google Gemini (Free API)').max_tokens, 5);
  delete process.env.OLLAMA_API_KEY;
});

test('the direct Ollama fallback authenticates against Ollama Cloud', async () => {
  const { makeOpenAI } = await import('../openaiClient.js');
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
    // Every other provider is down, so the chain has to reach Ollama.
    throw new Error('offline');
  };
  process.env.OLLAMA_API_KEY = 'cloud-key';
  process.env.OLLAMA_BASE_URL = 'https://ollama.example/v1';
  try {
    const ai = makeOpenAI();
    await ai.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }).catch(() => {});
    const direct = seen.filter(s => s.url === 'https://ollama.example/v1/chat/completions');
    assert.ok(direct.length > 0, 'Ollama was called');
    assert.ok(direct.every(s => s.auth === 'Bearer cloud-key'), 'every Ollama call carries the key');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
  }
});
