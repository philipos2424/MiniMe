/**
 * The Pro/Free model gate.
 *
 * What this protects: a merchant paying 1,999 ETB/month is told Pro replies use
 * the stronger model. That claim is only true while Pro traffic actually
 * reaches OpenAI, and provider order is decided by env vars that are changed
 * from the Vercel dashboard without a deploy. A regression here is silent —
 * replies keep working, they just quietly come from the free model, and the
 * marketing claim becomes false with nothing failing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = process.cwd().replace(/apps[\\/]web$/, '');
const wrapper = readFileSync(`${root}apps/web/src/lib/server/openai-wrapper.js`, 'utf8');
const engine = readFileSync(`${root}apps/web/src/lib/server/replyEngine.js`, 'utf8');

// Every provider needs a key present or getProviderClients() drops it entirely,
// and an absent provider would make these assertions pass for the wrong reason.
process.env.OPENAI_API_KEY = 'sk-test';
process.env.GROQ_API_KEY = 'gsk-test';
process.env.GEMINI_API_KEY = 'gem-test';
delete process.env.AI_OPENAI_FIRST;
delete process.env.AI_PRO_MODEL_GATE;
delete process.env.USE_OLLAMA;
delete process.env.OLLAMA_ENABLED;
delete process.env.OPENAI_BASE_URL;

const { getProviderClients } = await import('../openaiClient.js');

const names = (opts) => getProviderClients(opts).map(c => c.name);

test('Pro reaches OpenAI first; Free does not', () => {
  assert.match(names({ prefer: 'quality' })[0], /OpenAI/);
  assert.match(names({ prefer: 'fast' })[0], /Groq/);
});

test('omitting prefer keeps the pre-gate default order', () => {
  // Every internal route (advisor, research, tagging) calls with no options.
  // Those must be byte-identical to how they behaved before the gate existed.
  assert.deepEqual(names(), names({ prefer: 'fast' }));
  assert.match(names()[0], /Groq/);
});

test('Free still has OpenAI as a fallback, just not first', () => {
  // The gate must not strand Free users when Groq and Gemini are both down.
  assert.ok(names({ prefer: 'fast' }).some(n => /OpenAI/.test(n)));
});

test('AI_PRO_MODEL_GATE=false degrades Pro to the Free path, not to an error', () => {
  // The credits kill switch. When OpenAI has no balance, sending Pro traffic
  // there first reinstates the guaranteed-fail round trip the default order
  // exists to avoid.
  process.env.AI_PRO_MODEL_GATE = 'false';
  assert.match(names({ prefer: 'quality' })[0], /Groq/);
  assert.ok(names({ prefer: 'quality' }).some(n => /OpenAI/.test(n)));
  delete process.env.AI_PRO_MODEL_GATE;
});

test('AI_OPENAI_FIRST still overrides for everyone, gate or no gate', () => {
  process.env.AI_OPENAI_FIRST = 'true';
  assert.match(names()[0], /OpenAI/);
  assert.match(names({ prefer: 'fast' })[0], /OpenAI/);
  delete process.env.AI_OPENAI_FIRST;
});

test('the gate is opt-in — tier is never inferred inside the wrapper', () => {
  // If the wrapper ever defaulted absent tier to 'free', every internal route
  // would silently change provider. Only an explicit 'pro' may promote.
  assert.match(wrapper, /tier === 'pro' \? \{ prefer: 'quality' \} : undefined/);
});

test('both merchant-facing reply routes are gated, not just one', () => {
  // fast_reply is the higher-volume path; gating generate_reply alone would
  // make the claim true for a minority of replies.
  for (const route of ['generate_reply', 'fast_reply']) {
    const at = engine.indexOf(`route: '${route}'`);
    assert.ok(at > 0, `${route} not found`);
    const block = engine.slice(at, at + 900);
    assert.match(block, /tier: isProServer\(business\) \? 'pro' : 'free'/,
      `${route} is not passing a tier`);
  }
});
