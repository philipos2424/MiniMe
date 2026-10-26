/**
 * Platform health reports failure rates with sample sizes, from one definition
 * shared with Insights and Pulse (the tabs used to disagree: Pulse "normal"
 * while Insights showed 18.9% of AI calls failing).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { platformHealth, failureRates24h, verdict, AI_FAIL_ALERT_PCT, MIN_SAMPLE } from '../metrics/health.mjs';

const now = Date.parse('2026-10-26T12:00:00Z');
const at = minsAgo => new Date(now - minsAgo * 60000).toISOString();
const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('18.9% AI failure is a failure (Pulse used to say normal at this rate)', () => {
  const llm = Array.from({ length: 37 }, (_, i) => ({ route: 'reply', ok: i >= 7, created_at: at(30) }));
  const ai = platformHealth({ now, llmRecent: llm }).find(c => c.key === 'ai');
  assert.equal(ai.status, 'fail');
  assert.match(ai.note, /^18\.9% failed on every provider \(7\/37\)/);
});

test('raw provider attempts, the daily summary and old rows are not chain calls', () => {
  const r = failureRates24h({ now, llmRecent: [
    { route: 'raw:gemini', ok: false, created_at: at(5) },
    { route: '__daily_summary__', ok: false, created_at: at(5) },
    { route: 'reply', ok: false, created_at: at(60 * 25) },
    { route: 'reply', ok: true, created_at: at(5) },
  ] });
  assert.deepEqual([r.llm_calls_24h, r.llm_failed_24h, r.llm_fail_pct_24h], [1, 0, 0]);
});

test('too little data is unknown, never OK', () => {
  assert.equal(verdict(0, MIN_SAMPLE - 1, AI_FAIL_ALERT_PCT), 'unknown');
  assert.equal(verdict(null, 0, AI_FAIL_ALERT_PCT), 'unknown');
  const checks = platformHealth({ now });
  for (const k of ['ai', 'delivery', 'webhooks']) assert.equal(checks.find(c => c.key === k).status, 'unknown', k);
  assert.equal(checks.find(c => c.key === 'rollup').status, 'fail', 'a job that never ran is not OK');
});

test('delivery and webhook rates, and a stale or failed metrics job', () => {
  const msgs = Array.from({ length: 20 }, (_, i) => ({ business_id: 'b', direction: 'outbound', status: i < 2 ? 'failed' : 'sent', created_at: at(10) }));
  const hooks = Array.from({ length: 20 }, (_, i) => ({ delivery_status: i < 3 ? 'error' : 'success' }));
  const checks = platformHealth({ now, recentMessages: msgs, webhooks: hooks, runs: [{ ok: true, finished_at: at(60) }] });
  assert.equal(checks.find(c => c.key === 'delivery').status, 'fail'); // 10% >= 5%
  assert.equal(checks.find(c => c.key === 'webhooks').status, 'fail'); // 85% < 90%
  assert.equal(checks.find(c => c.key === 'rollup').status, 'ok');
  assert.equal(platformHealth({ now, runs: [{ ok: false }, { ok: true, finished_at: at(60) }] }).find(c => c.key === 'rollup').status, 'fail');
});

test('Insights, Pulse and the Platform health tab all use the shared definitions', () => {
  const insights = read('lib/server/metrics/insights.mjs');
  assert.match(insights, /failureRates24h\(\{ now, extIds, recentMessages, llmRecent \}\)/);
  assert.match(insights, />= AI_FAIL_ALERT_PCT\)/);
  const pulse = read('app/api/admin/pulse/route.js');
  assert.match(pulse, /\.filter\(isChainCall\)/);
  assert.match(pulse, /aiFailPct >= AI_FAIL_ALERT_PCT/);
  assert.doesNotMatch(pulse, /aiFailPct > 25/);
  const admin = read('app/admin/page.js');
  assert.match(admin, /fetch\('\/api\/admin\/health'/);
  assert.doesNotMatch(admin, /name: 'Order pipeline', ok: true/);
});
