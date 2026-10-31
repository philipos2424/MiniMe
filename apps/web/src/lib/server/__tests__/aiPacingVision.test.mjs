import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { waitForGeminiSlot, _resetGeminiPacing, hasImageParts, providerCantSeeImages, inlineImageUrls } from '../openaiClient.js';

const here = fileURLToPath(new URL('.', import.meta.url));

test('background Gemini calls are spaced out, one at a time', async () => {
  _resetGeminiPacing();
  let clock = 1000;
  const waits = [];
  const wait = async (ms) => { waits.push(ms); clock += ms; };
  const now = () => clock;
  await Promise.all([waitForGeminiSlot(7000, now, wait), waitForGeminiSlot(7000, now, wait), waitForGeminiSlot(7000, now, wait)]);
  assert.deepEqual(waits, [7000, 7000]);
  _resetGeminiPacing();
});

test('image calls skip text-only Groq', () => {
  const msgs = [{ role: 'user', content: [{ type: 'text', text: 'tag this' }, { type: 'image_url', image_url: { url: 'https://x/y.jpg' } }] }];
  assert.equal(hasImageParts(msgs), true);
  assert.equal(hasImageParts([{ role: 'user', content: 'hi' }]), false);
  assert.equal(providerCantSeeImages({ name: 'Groq (Ultra-Fast API)' }), true);
  assert.equal(providerCantSeeImages({ name: 'Google Gemini (Free API)' }), false);
});

test('Ollama gets images inlined as base64', async () => {
  const fakeFetch = async () => ({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const out = await inlineImageUrls({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }, { type: 'text', text: 'hi' }] }] }, fakeFetch);
  assert.equal(out.messages[0].content[0].image_url.url, 'data:image/png;base64,AQID');
  assert.equal(out.messages[0].content[1].text, 'hi');
  const plain = { messages: [{ role: 'user', content: 'x' }] };
  assert.equal(await inlineImageUrls(plain, fakeFetch), plain);
});

test('nightly jobs: owner facts only for active shops, moved off the 03:00 rush, both time-boxed', () => {
  const facts = readFileSync(`${here}../../../app/api/cron/extract-owner-facts/route.js`, 'utf8');
  assert.match(facts, /gte\('last_shop_activity_date'/);
  assert.match(facts, /260000/);
  assert.match(readFileSync(`${here}../../../app/api/cron/auto-learn/route.js`, 'utf8'), /260000/);
  assert.match(readFileSync(`${here}../../../../vercel.json`, 'utf8'), /extract-owner-facts","schedule": "30 2/);
});
