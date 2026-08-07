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

test('every emitted model + param shape is accepted by the live API', { skip: !hasKey }, async (t) => {
  const { openai } = require('../apps/bot/src/services/aiClient.js');

  for (const model of EMITTED_MODELS) {
    for (const shape of EMITTED_PARAM_SHAPES) {
      const { name, ...params } = shape;
      await t.test(`${model ?? '(default)'} / ${name}`, async () => {
        const warnings = [];
        const origWarn = console.warn;
        console.warn = (...a) => warnings.push(a.join(' '));
        try {
          const res = await openai.chat.completions.create({
            model: resolveModel(model),
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

          // The real assertion: OpenAI must have answered on the FIRST try.
          // A fallback warning means we degraded to Groq/Gemini/Ollama, which
          // is exactly the silent failure this suite exists to catch.
          const fellBack = warnings.filter(w => w.includes('[bot-ai-fallback]'));
          assert.equal(
            fellBack.length, 0,
            `degraded to a fallback provider instead of OpenAI:\n  ${fellBack.join('\n  ')}`,
          );
        } finally {
          console.warn = origWarn;
        }
      });
    }
  }
});

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

test('classifier output is coerced into the shared vocabulary', { skip: !hasKey }, async () => {
  const { detectIntent } = require('../apps/bot/src/services/ai.js');
  const res = await detectIntent('ሰላም! የዋጋ ዝርዝር አለዎት?', []);
  assert.ok(constants.INTENT_VALUES.includes(res.intent), `bad intent: ${res.intent}`);
  assert.ok(constants.SENTIMENT_VALUES.includes(res.sentiment), `bad sentiment: ${res.sentiment}`);
  assert.ok(constants.URGENCY_VALUES.includes(res.urgency), `bad urgency: ${res.urgency}`);
  assert.ok(Array.isArray(res.topics), 'topics must be an array');
});
