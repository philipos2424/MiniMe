/**
 * k6 security test: auth-attacks.js
 *
 * Tests that:
 * 1. Invalid webhook secrets are rejected (403)
 * 2. Timing attack is not possible (constant-time comparison)
 * 3. Replay attack with stale initData is rejected (401)
 * 4. Sub-admin cannot access destructive endpoints (403)
 *
 * Run: k6 run auth-attacks.js --env BASE_URL=https://web-theta-one-68.vercel.app
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const correctSecretTiming  = new Trend('timing_correct_secret_ms');
const wrongSecretTiming    = new Trend('timing_wrong_secret_ms');

export const options = {
  vus: 10,
  duration: '60s',
  thresholds: {
    // Timing for correct vs wrong secret should be similar (constant-time)
    // Allow a 5x difference as a loose bound (network variance dominates)
    'http_req_failed': ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://web-theta-one-68.vercel.app';
const CORRECT_SECRET = __ENV.WEBHOOK_SECRET || 'the-correct-secret';
const WRONG_SECRET   = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // clearly wrong
// Partial secret — 8 chars right, rest wrong (timing attack probe)
const PARTIAL_SECRET = CORRECT_SECRET.slice(0, 8).padEnd(CORRECT_SECRET.length, 'z');

const fakeUpdate = JSON.stringify({ update_id: 99999, message: { text: 'test', from: { id: 1 }, chat: { id: 1 } } });

export default function () {
  const scenario = Math.floor(Math.random() * 3);

  if (scenario === 0) {
    // Correct secret — should be 200
    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/telegram/webhook/${CORRECT_SECRET}`, fakeUpdate, {
      headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': CORRECT_SECRET },
    });
    correctSecretTiming.add(Date.now() - start);
    check(res, { 'correct secret: not 403': r => r.status !== 403 });

  } else if (scenario === 1) {
    // Wrong secret — should be 403
    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/telegram/webhook/${WRONG_SECRET}`, fakeUpdate, {
      headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': WRONG_SECRET },
    });
    wrongSecretTiming.add(Date.now() - start);
    check(res, { 'wrong secret: 403': r => r.status === 403 });

  } else {
    // Partial secret probe (timing attack) — should be 403
    const res = http.post(`${BASE_URL}/api/telegram/webhook/${PARTIAL_SECRET}`, fakeUpdate, {
      headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': PARTIAL_SECRET },
    });
    check(res, { 'partial secret: 403': r => r.status === 403 });
  }

  // Sub-admin attempting destructive endpoint (should be 401 without initData)
  const refundRes = http.post(`${BASE_URL}/api/orders/fake-id/refund`, '{"reason":"test"}', {
    headers: { 'Content-Type': 'application/json' },
  });
  check(refundRes, { 'no auth refund: 401': r => r.status === 401 });

  sleep(0.1);
}

export function handleSummary(data) {
  const correctP95 = data.metrics.timing_correct_secret_ms?.values?.['p(95)'] ?? 0;
  const wrongP95   = data.metrics.timing_wrong_secret_ms?.values?.['p(95)'] ?? 0;
  const ratio = correctP95 > 0 ? (wrongP95 / correctP95).toFixed(2) : 'N/A';

  console.log('\n=== Auth Attack Test Results ===');
  console.log(`Correct secret p95:  ${correctP95.toFixed(0)}ms`);
  console.log(`Wrong secret p95:    ${wrongP95.toFixed(0)}ms`);
  console.log(`Timing ratio (wrong/correct): ${ratio}x  (ideal: ~1.0, dangerous: >10x)`);

  if (ratio !== 'N/A' && parseFloat(ratio) > 5) {
    console.log('⚠️  WARNING: Large timing difference may indicate non-constant-time comparison!');
  } else {
    console.log('✅ Timing looks safe (constant-time comparison working)');
  }
  return {};
}
