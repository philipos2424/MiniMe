/**
 * Pricing rules — the most expensive logic in the codebase to get wrong.
 *
 * estimateCost feeds the admin cost, economics and Pulse dashboards (merchant
 * credits are debited by token count, not by this). It once had no entry for
 * the fallback providers, so an OpenAI outage reported Groq's free calls at
 * gpt-5.5-pro rates; and it priced the paid Gemini key as free, so the
 * dashboards showed ~$0 while Google billed real money.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, priceFor, PRICING, FREE_MODELS } from '../llmPricing.mjs';

test('free fallback providers cost nothing', () => {
  // The regression: these fell through to the flagship default and charged
  // merchant credits for calls that are genuinely free to us.
  for (const model of FREE_MODELS) {
    assert.equal(estimateCost(model, 100_000, 50_000), 0, `${model} must be free`);
  }
});

test('Gemini is paid: 3.5 Flash bills as 3.6 Flash, and the price doubles on 2027-01-01', () => {
  assert.equal(FREE_MODELS.has('gemini-3.5-flash'), false);
  const before = Date.UTC(2026, 9, 17);
  const after = Date.UTC(2027, 0, 1);
  assert.deepEqual(priceFor('gemini-3.5-flash', before), { in: 0.75, cached: 0.075, out: 3.75 });
  assert.deepEqual(priceFor('gemini-3.6-flash', before), priceFor('gemini-3.5-flash', before));
  assert.deepEqual(priceFor('gemini-3.5-flash', after), { in: 1.50, cached: 0.15, out: 7.50 });
  assert.deepEqual(priceFor('gemini-3.5-flash', after - 1), priceFor('gemini-3.5-flash', before));
  // estimateCost uses the price in force now: never zero, never flagship.
  const now = estimateCost('gemini-3.5-flash', 1_000_000, 1_000_000);
  assert.ok(now > 0 && now < estimateCost('gpt-5.5-pro', 1_000_000, 1_000_000));
  assert.equal(estimateCost('gemini-2.5-flash', 1_000_000, 1_000_000), 2.8);
});

test("Groq's free models are free, including the gpt-oss-20b default", () => {
  assert.equal(estimateCost('openai/gpt-oss-20b', 100_000, 50_000), 0);
});

test('local Ollama tags are free whatever the tag', () => {
  for (const model of ['llama3.2', 'qwen2.5:7b', 'mistral:latest', 'phi3', 'gemma2:9b', 'deepseek-r1']) {
    assert.equal(estimateCost(model, 10_000, 10_000), 0, `${model} must be free`);
  }
});

test('the 4.x models bill at their own rate, not the flagship default', () => {
  // 1M prompt + 1M completion on gpt-4.1 = $2 + $8. Under the old default it
  // was billed as gpt-5.5-pro: $5 + $30 = $35, a 3.5x overcharge.
  assert.equal(estimateCost('gpt-4.1', 1_000_000, 1_000_000), 10);
  assert.equal(estimateCost('gpt-4.1-mini', 1_000_000, 1_000_000), 2);
  assert.equal(estimateCost('gpt-4o-mini', 1_000_000, 1_000_000), 0.75);
  // Each must be strictly cheaper than the flagship it used to be charged as.
  const flagship = estimateCost('gpt-5.5-pro', 1_000_000, 1_000_000);
  for (const m of ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini']) {
    assert.ok(estimateCost(m, 1_000_000, 1_000_000) < flagship, `${m} should cost less than flagship`);
  }
});

test('cached prompt tokens are billed at the discounted rate', () => {
  const p = PRICING['gpt-4.1'];
  // Half the prompt served from cache.
  const cost = estimateCost('gpt-4.1', 1_000_000, 0, 500_000);
  const expected = (500_000 * p.in + 500_000 * p.cached) / 1_000_000;
  assert.equal(cost, expected);
  // Cached can never exceed prompt, even if a provider reports nonsense.
  assert.equal(estimateCost('gpt-4.1', 1000, 0, 999_999), estimateCost('gpt-4.1', 1000, 0, 1000));
});

test('unknown models fall back to flagship rates rather than silently free', () => {
  // Deliberate: under-reporting our own spend is the more dangerous error.
  const unknown = estimateCost('some-new-model-2027', 1_000_000, 0);
  assert.equal(unknown, estimateCost('gpt-5.5-pro', 1_000_000, 0));
  assert.equal(priceFor('some-new-model-2027'), null, 'unknown model has no price row');
});

test('missing or zero usage costs nothing', () => {
  assert.equal(estimateCost('gpt-4.1', 0, 0), 0);
  assert.equal(estimateCost('gpt-4.1', undefined, undefined), 0);
  assert.equal(estimateCost(null, 1000, 1000) > 0, true, 'null model still bills, at flagship');
});
