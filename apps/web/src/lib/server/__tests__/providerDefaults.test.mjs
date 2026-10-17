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
