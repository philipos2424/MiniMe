/**
 * AI contract tests.
 *
 * These exist because of a class of bug that was invisible in production: the
 * bot kept "working" while every OpenAI request 400'd, because the multi-
 * provider proxy silently failed over to a local 4B model. Nothing threw,
 * nothing alerted — replies just quietly got worse.
 *
 * Two independent contracts are checked:
 *
 *   1. MODEL/PARAM CONTRACT (live, needs OPENAI_API_KEY) — every model name and
 *      parameter shape the code actually emits is accepted by the real API.
 *   2. VOCABULARY CONTRACT (offline) — every intent/sentiment value the code
 *      branches on is a value the classifier is allowed to emit.
 *
 * Run:  node --test tests/ai-contract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('dotenv').config();

const constants = require('../packages/shared/constants.js');
const { resolveModel } = require('../apps/bot/src/services/aiClient.js');

const hasKey = !!process.env.OPENAI_API_KEY
  && !['sk-placeholder', 'ollama'].includes(process.env.OPENAI_API_KEY);

// ---------------------------------------------------------------------------
// 1. Model + parameter contract
// ---------------------------------------------------------------------------

// Every model string that appears at a call site in the bot.
const EMITTED_MODELS = ['gpt-5.5', 'gpt-5.5-pro', 'gpt-4o', 'gpt-4o-mini', undefined];

// The parameter shapes the call sites use. These were all written against
// gpt-4o and pass max_tokens + temperature, which gpt-5.x rejects outright —
// aiClient must translate them transparently.
const EMITTED_PARAM_SHAPES = [
  { name: 'reply generation', max_tokens: 350, temperature: 0.78 },
  { name: 'intent detection (json)', max_tokens: 150, temperature: 0.3, response_format: { type: 'json_object' } },
  { name: 'supplier draft', max_tokens: 400, temperature: 0.7 },
  { name: 'payment reminder', max_tokens: 200, temperature: 0.75 },
];

test('resolveModel never returns a non-chat model', () => {
  for (const m of EMITTED_MODELS) {
    const resolved = resolveModel(m);
    assert.ok(resolved, `resolveModel(${m}) returned empty`);
    // gpt-5.5-pro is listed by /v1/models but 404s on /v1/chat/completions.
    assert.ok(
      !/-pro\b/.test(resolved),
      `resolveModel(${m}) => "${resolved}" is a *-pro model, which is not a chat model`,
    );
  }
});

/**
 * BOTH client implementations must satisfy this contract. The LIVE production
 * path is the web client — a suite that only covered the bot client (which is
 * dormant) would not have caught the bug it was written for.
 *
 * The web client is ESM, the bot client is CJS, hence the mixed loaders.
 */
const CLIENTS = [
  { name: 'apps/bot (legacy)', load: async () => require('../apps/bot/src/services/aiClient.js').openai },
  { name: 'apps/web (LIVE)', load: async () => (await import('../apps/web/src/lib/server/openaiClient.js')).makeOpenAI() },
];

for (const client of CLIENTS) {
test(`${client.name}: every emitted model + param shape reaches real OpenAI`, { skip: !hasKey }, async (t) => {
  const openai = await client.load();

  for (const model of EMITTED_MODELS) {
    for (const shape of EMITTED_PARAM_SHAPES) {
      const { name, ...params } = shape;
      await t.test(`${model ?? '(default)'} / ${name}`, async () => {
        const res = await openai.chat.completions.create({
          // Pass the RAW call-site name and let each client normalise it
          // internally — exactly as production does. Pre-normalising here
          // (e.g. via the bot's resolveModel) bypasses the very mapping under
          // test, so a broken normalizeModelName in one client would be
          // masked by the other client's correct one.
          model,
          // json_object mode requires the literal word "json" somewhere in
          // the messages, or the API 400s. The real prompts all say
          // "Return ONLY a valid JSON object", so mirror that here.
          messages: [{
            role: 'user',
            content: params.response_format
              ? 'Return ONLY a valid JSON object: {"ok": true}'
              : 'Reply with exactly: OK',
          }],
          ...params,
        });
        assert.ok(res.choices?.[0]?.message?.content, 'empty completion');

        // The real assertion, and the whole reason this suite exists: prove
        // WHICH provider answered, by inspecting the echoed model id.
        //
        // Counting "[...-fallback]" console warnings does NOT work. When
        // USE_OLLAMA / OLLAMA_ENABLED is set (or OPENAI_BASE_URL points at
        // :11434) the client unshifts Ollama to index 0 — the first provider
        // succeeds, zero warnings are emitted, and the test would pass green
        // while running entirely on gemma3:4b. That is precisely the silent
        // degradation being guarded against, so assert on the response.
        assert.match(
          res.model || '',
          /^gpt-5/,
          `answered by "${res.model}" — degraded off real OpenAI onto a fallback provider`,
        );
      });
    }
  }
});
}

// ---------------------------------------------------------------------------
// 2. Vocabulary contract
// ---------------------------------------------------------------------------

test('every intent branched on is one the classifier can emit', () => {
  const branched = [
    ...constants.ROUTINE_INTENTS,
    ...constants.COMPLEX_INTENTS,
    ...constants.CLOSING_INTENTS,
  ];
  for (const intent of branched) {
    assert.ok(
      constants.INTENT_VALUES.includes(intent),
      `"${intent}" is branched on but is not in INTENT_VALUES — that branch is dead code`,
    );
  }
});

test('every sentiment branched on is one the classifier can emit', () => {
  const branched = [...constants.NEGATIVE_SENTIMENTS, ...constants.POSITIVE_SENTIMENTS];
  for (const sentiment of branched) {
    assert.ok(
      constants.SENTIMENT_VALUES.includes(sentiment),
      `"${sentiment}" is branched on but is not in SENTIMENT_VALUES — that branch is dead code`,
    );
  }
});

test('the intent prompt advertises exactly the shared vocabulary', () => {
  const ai = require('../apps/bot/src/services/ai.js');
  assert.ok(typeof ai.summarizeConversation === 'function',
    'message.js calls summarizeConversation — it must be exported');

  // Guard against someone hardcoding an enum back into the prompt.
  const src = require('node:fs').readFileSync(
    new URL('../apps/bot/src/services/ai.js', import.meta.url), 'utf8');
  for (const stale of ['positive|neutral|negative', 'catalog', 'faq', 'hours']) {
    assert.ok(!src.includes(stale),
      `ai.js still references the stale classifier vocabulary "${stale}"`);
  }
});

/**
 * Behavioural matrix over the REAL escalation function.
 *
 * The vocabulary tests above compare constants to constants, all defined in
 * one file — they cannot catch the bug that actually shipped, which was an
 * inline literal at a branch site (`sentiment === 'negative'`, and an
 * urgentIntents list of 'urgent'/'refund'/'problem'/'issue'). This drives the
 * exported function across the full classifier vocabulary instead, so any
 * future inline literal shows up as a wrong answer.
 */
test('isImportantForOwner: escalation matrix over the real vocabulary', async () => {
  const { isImportantForOwner } = await import('../apps/web/src/lib/server/notification.js');
  const web = await import('../apps/web/src/lib/server/constants.js');

  const calm = { confidence: 0.99, flagReason: null, isNew: false };
  const call = (intent, sentiment) =>
    isImportantForOwner(calm.confidence, { intent, sentiment }, calm.flagReason, calm.isNew);

  // Every negative sentiment must escalate, whatever the intent.
  for (const sentiment of web.NEGATIVE_SENTIMENTS) {
    assert.equal(call('general', sentiment), true,
      `sentiment "${sentiment}" must page the owner — an upset customer must never sit silently`);
  }

  // Every urgent intent must escalate, whatever the sentiment.
  for (const intent of web.URGENT_INTENTS) {
    assert.equal(call(intent, 'neutral'), true, `intent "${intent}" must page the owner`);
  }

  // Calm routine traffic must NOT escalate, or the owner learns to ignore it.
  for (const intent of web.ROUTINE_INTENTS) {
    assert.equal(call(intent, 'happy'), false,
      `routine intent "${intent}" with happy sentiment must stay silent`);
  }

  // Regression guard: 'order' is in COMPLEX_INTENTS but must NOT page the
  // owner. Aliasing urgentIntents to COMPLEX_INTENTS silently added it.
  assert.equal(call('order', 'neutral'), false,
    "'order' must not page the owner — that is a notification-volume change, not a bugfix");

  // Regression guard: the literal 'negative' is NOT in the classifier's enum.
  // If someone reintroduces it as the negativity test, the loop above fails —
  // this asserts it is not silently treated as meaningful either.
  assert.ok(!web.SENTIMENT_VALUES.includes('negative'),
    "'negative' is not an emittable sentiment; do not branch on it");

  // The independent escalation triggers still work.
  assert.equal(isImportantForOwner(0.2, { intent: 'greeting', sentiment: 'happy' }, null, false), true,
    'low confidence must escalate');
  assert.equal(isImportantForOwner(0.99, { intent: 'greeting', sentiment: 'happy' }, 'scam', false), true,
    'flagged messages must escalate');
  assert.equal(isImportantForOwner(0.99, { intent: 'greeting', sentiment: 'happy' }, null, true), true,
    'a brand new customer must escalate');
});

test('a failed classification is never confident enough to auto-send', async () => {
  const constants = require('../packages/shared/constants.js');
  // detectIntent's failure path must be distinguishable from a genuine
  // neutral/general message, or a reply to a message we never understood can
  // clear the auto-send threshold at TRUSTED.
  const src = require('node:fs').readFileSync(
    new URL('../apps/bot/src/services/ai.js', import.meta.url), 'utf8');
  assert.ok(src.includes('_error'),
    'coerceIntent must mark hard failures so the reply path can refuse to auto-send');

  const replySrc = require('node:fs').readFileSync(
    new URL('../apps/bot/src/services/reply.js', import.meta.url), 'utf8');
  assert.ok(replySrc.includes('intent._error'),
    'calculateConfidence must penalise a failed classification');
  assert.ok(constants.NEGATIVE_SENTIMENTS.length > 0, 'sanity');
});

test('classifier output is coerced into the shared vocabulary', { skip: !hasKey }, async () => {
  const { detectIntent } = require('../apps/bot/src/services/ai.js');
  const res = await detectIntent('ሰላም! የዋጋ ዝርዝር አለዎት?', []);
  assert.ok(constants.INTENT_VALUES.includes(res.intent), `bad intent: ${res.intent}`);
  assert.ok(constants.SENTIMENT_VALUES.includes(res.sentiment), `bad sentiment: ${res.sentiment}`);
  assert.ok(constants.URGENCY_VALUES.includes(res.urgency), `bad urgency: ${res.urgency}`);
  assert.ok(Array.isArray(res.topics), 'topics must be an array');
});
