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

// ── Lanes and benching ───────────────────────────────────────────────────────

const pool = () => [
  { name: 'Google Gemini (Free API)' },
  { name: 'Groq (Ultra-Fast API)' },
  { name: 'OpenAI (Primary API Key)' },
  { name: 'Ollama (Local LLM)' },
];

test('background work runs on Gemini only; customer replies get the whole chain', async () => {
  const { selectProviders, laneFor, resetProviderBench } = await import('../openaiClient.js');
  resetProviderBench();
  assert.equal(laneFor('auto_learn'), 'background');
  assert.equal(laneFor('generate_reply'), 'customer');
  assert.equal(laneFor('agent_brain', 'background'), 'background');
  assert.deepEqual(selectProviders(pool(), { lane: 'background' }).map(c => c.name), ['Google Gemini (Free API)']);
  assert.equal(selectProviders(pool(), { lane: 'customer' }).length, 4);
});

test('a no-credits error benches that provider; a 503 does not', async () => {
  const { selectProviders, noteProviderFailure, resetProviderBench } = await import('../openaiClient.js');
  resetProviderBench();
  noteProviderFailure({ name: 'Groq (Ultra-Fast API)' }, Object.assign(new Error('503 high demand'), { status: 503 }));
  noteProviderFailure({ name: 'OpenAI (Primary API Key)' }, Object.assign(new Error('429 You exceeded your current quota'), { code: 'insufficient_quota' }));
  const names = selectProviders(pool()).map(c => c.name);
  assert.ok(names.includes('Groq (Ultra-Fast API)'), 'a transient error must not bench');
  assert.ok(!names.includes('OpenAI (Primary API Key)'), 'no credits must bench');
  resetProviderBench();
});

test('background work waits rather than falling back while Gemini is out of budget', async () => {
  const { selectProviders, noteProviderFailure, resetProviderBench } = await import('../openaiClient.js');
  resetProviderBench();
  noteProviderFailure({ name: 'Google Gemini (Free API)' }, new Error('429 spending cap reached'));
  assert.deepEqual(selectProviders(pool(), { lane: 'background' }), []);
  assert.ok(selectProviders(pool(), { lane: 'customer' }).every(c => !c.name.includes('Gemini')));
  resetProviderBench();
});

test('a customer is never left with an empty chain, even if everything is benched', async () => {
  const { selectProviders, noteProviderFailure, resetProviderBench } = await import('../openaiClient.js');
  resetProviderBench();
  for (const c of pool()) noteProviderFailure(c, new Error('insufficient_quota'));
  assert.equal(selectProviders(pool(), { lane: 'customer' }).length, 4);
  resetProviderBench();
});

test('on Vercel a loopback Ollama is left out of the chain; Ollama Cloud stays in', async () => {
  const { getProviderClients } = await import('../openaiClient.js');
  process.env.VERCEL = '1';
  try {
    delete process.env.OLLAMA_BASE_URL;
    assert.ok(!getProviderClients().some(c => c.name.includes('Ollama')));
    process.env.OLLAMA_BASE_URL = 'https://ollama.com/v1';
    assert.ok(getProviderClients().some(c => c.name.includes('Ollama')));
  } finally {
    delete process.env.VERCEL;
    delete process.env.OLLAMA_BASE_URL;
  }
});

test('a background call whose Gemini fails throws without touching the fallbacks', async () => {
  const { makeOpenAI, resetProviderBench } = await import('../openaiClient.js');
  resetProviderBench();
  const realFetch = globalThis.fetch;
  const hosts = [];
  globalThis.fetch = async (url) => { hosts.push(new URL(String(url)).host); throw new Error('offline'); };
  process.env.GEMINI_API_KEY = 'test';
  try {
    const ai = makeOpenAI();
    await assert.rejects(ai.chat.completions.create({ route: 'auto_learn', messages: [{ role: 'user', content: 'x' }] }), /background lane/);
    assert.ok(hosts.length > 0 && hosts.every(h => h === 'generativelanguage.googleapis.com'), `only Gemini was called, got ${[...new Set(hosts)]}`);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  }
});
