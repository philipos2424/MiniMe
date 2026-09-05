/**
 * llmCallLog — route attribution, plus regression guards for the rollup
 * double-counting bug that made llm_call_log read ~80x real spend.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAILY_SUMMARY_ROUTE, inferRoute } from '../llmCallLog.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

test('DAILY_SUMMARY_ROUTE is the literal every dashboard filters on', () => {
  assert.equal(DAILY_SUMMARY_ROUTE, '__daily_summary__');
});

// ── inferRoute ───────────────────────────────────────────────────────────────

test('inferRoute attributes a call to the first non-plumbing frame', () => {
  const stack = [
    'Error',
    '    at logProviderCall (/app/src/lib/server/openaiClient.js:120:5)',
    '    at create (/app/src/lib/server/openaiClient.js:290:9)',
    '    at runBrain (/app/src/lib/server/agentBrain.js:1101:30)',
    '    at handler (/app/src/app/api/telegram/route.js:22:3)',
  ].join('\n');
  assert.equal(inferRoute(stack), 'raw:agentBrain');
});

test('inferRoute skips the logger, the wrapper, and node internals', () => {
  const stack = [
    'Error',
    '    at logCall (/app/src/lib/server/llmCallLog.mjs:70:3)',
    '    at Object.create (/app/src/lib/server/openaiClient.js:290:9)',
    '    at loggedCompletion (/app/src/lib/server/openai-wrapper.js:160:20)',
    '    at process (node:internal/process/task_queues:95:5)',
    '    at parse (/app/node_modules/openai/core.js:10:1)',
    '    at teach (/app/src/lib/server/teaching.js:44:9)',
  ].join('\n');
  assert.equal(inferRoute(stack), 'raw:teaching');
});

test('inferRoute never throws on junk input', () => {
  for (const junk of [null, undefined, '', 'Error', 42, {}]) {
    assert.equal(typeof inferRoute(junk), 'string');
  }
  assert.equal(inferRoute(null), 'raw:unknown');
});

test('inferRoute falls back rather than returning a plumbing frame', () => {
  const stack = 'Error\n    at create (/app/src/lib/server/openaiClient.js:290:9)';
  assert.equal(inferRoute(stack), 'raw:unknown');
});

// ── The rollup double-count regression ───────────────────────────────────────
//
// /api/cron/llm-stats reads "yesterday's" rows and writes ONE __daily_summary__
// row holding the day's totals. That row lands inside the next run's window, so
// without an explicit filter each summary contains the previous day's summary —
// S(n) = R(n) + S(n-1), a running cumulative total wearing a daily label. The
// live series climbed monotonically (23k prompt tokens → 1.38M in five weeks)
// and a 30-day SUM read $184 against $2.81 of real spend.

test('the llm-stats cron excludes its own rollup rows from both source queries', () => {
  const src = read('../../../app/api/cron/llm-stats/route.js');

  // Both aggregate reads must filter. Counting matters: filtering only the
  // route query still leaves per-business totals compounding.
  const filters = src.match(/\.neq\('route',\s*DAILY_SUMMARY_ROUTE\)/g) || [];
  assert.equal(filters.length, 2,
    'both routeRows and bizRows queries must exclude DAILY_SUMMARY_ROUTE');

  // And the row it writes must use the same constant it filters on, so the
  // two can never drift apart.
  assert.match(src, /route:\s*DAILY_SUMMARY_ROUTE/,
    'the summary insert must use the shared constant');
  assert.doesNotMatch(src, /'__daily_summary__'/,
    'no bare literal — import DAILY_SUMMARY_ROUTE instead');
});

test('every dashboard that sums llm_call_log excludes the rollup row', () => {
  // These read cost/economics off the same table. A rollup row is a whole day
  // of traffic in one row; including it double-counts everything.
  for (const p of [
    '../../../app/api/admin/costs/route.js',
    '../../../app/api/admin/economics/route.js',
    '../../../app/api/admin/pulse/route.js',
    '../../../app/api/admin/unit-economics/route.js',
    '../../../app/api/cron/pulse-alert/route.js',
  ]) {
    assert.match(read(p), /neq\('route',\s*(?:'__daily_summary__'|DAILY_SUMMARY_ROUTE)\)/,
      `${p} must exclude the daily rollup row`);
  }
});

// ── Coverage of the second provider path ─────────────────────────────────────

test('makeOpenAI logs its chat calls, and strips our own params before the API', () => {
  const src = read('../openaiClient.js');

  assert.match(src, /logProviderCall\(/,
    'the makeOpenAI chat path must log — it carries the call sites loggedCompletion never saw');

  // sanitizeParams is a blacklist (spread + delete), so route/business_id would
  // otherwise be forwarded to the provider and 400 the request.
  assert.match(src, /const \{ route, business_id, conversation_id, \.\.\.callParams \} = params;/,
    'our own params must be destructured out before any provider call');
  // Match the CALL SITES specifically — `function sanitizeParams(params, ...)`
  // and `async function fallbackOllamaFetch(params)` are the definitions, and a
  // looser pattern matches those and always fails.
  assert.doesNotMatch(src, /sanitizeParams\(params, !isOpenAI\)/,
    'the provider must receive callParams, never the raw params object');
  assert.match(src, /sanitizeParams\(callParams, !isOpenAI\)/,
    'the chat path must sanitize the stripped params');
  assert.doesNotMatch(src, /await fallbackOllamaFetch\(params\)/,
    'the Ollama fallback must also receive the stripped params');
  assert.match(src, /await fallbackOllamaFetch\(callParams\)/,
    'the Ollama fallback must receive callParams');
});

test('audio transcription is deliberately left unlogged', () => {
  // Whisper bills per second of audio, not per token — estimateCost() would
  // record it as $0 and make a real cost look free. Documented, not forgotten.
  const src = read('../openaiClient.js');
  assert.match(src, /Audio transcription is deliberately NOT logged/,
    'the reason audio is excluded must stay written down');
});
