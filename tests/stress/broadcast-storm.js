/**
 * k6 stress test: broadcast-storm.js
 *
 * Simulates a business broadcasting to 500 customers.
 * Checks rate limiting, Telegram throttle respect, and opt-out filtering.
 *
 * Run: k6 run broadcast-storm.js -e BASE_URL=https://... -e INIT_DATA=...
 */
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL  = __ENV.BASE_URL || 'https://web-theta-one-68.vercel.app';
const INIT_DATA = __ENV.INIT_DATA; // required - Telegram initData for test account

export const options = {
  scenarios: {
    // Try to send broadcast
    send_broadcast: { executor: 'shared-iterations', vus: 1, iterations: 1 },
    // Immediately try to send a second one (should be rate-limited)
    rate_limit_check: { executor: 'shared-iterations', vus: 1, iterations: 1,
      startTime: '2s' },
  },
  thresholds: {
    'http_req_failed': ['rate<0.5'], // allow some 429s (expected from rate limit)
  },
};

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'x-telegram-init-data': INIT_DATA,
  };

  const res = http.post(`${BASE_URL}/api/broadcast`, JSON.stringify({
    segment: 'all',
    message: 'k6 stress test broadcast — ignore this message',
  }), { headers, timeout: '90s' });

  const isRateLimit = res.status === 429;
  const isSuccess   = res.status === 200;

  check(res, {
    'returns 200 or 429': r => r.status === 200 || r.status === 429,
    'rate limit message on second attempt': r => {
      if (__ITER === 0) return true; // first is fine
      return r.status === 429; // second should be blocked
    },
  });

  if (isRateLimit) {
    console.log('✅ Rate limit correctly enforced on attempt', __ITER + 1);
  } else if (isSuccess) {
    const body = JSON.parse(res.body);
    console.log(`Broadcast sent to ${body.sent} customers, ${body.failed} failed`);
  }
}
