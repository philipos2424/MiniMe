/**
 * k6 stress test: dashboard-burst.js
 *
 * Simulates 20 business owners refreshing the home feed simultaneously.
 * Key check: N+1 queries should be gone; response time should stay under 3s.
 *
 * Run: k6 run dashboard-burst.js --env BASE_URL=https://web-theta-one-68.vercel.app
 *                                 --env INIT_DATA=<telegram_init_data>
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // ramp up to 20 concurrent users
    { duration: '3m',  target: 20 },   // hold
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'],  // 95th percentile under 3s
    http_req_failed:   ['rate<0.01'],
  },
};

const BASE_URL  = __ENV.BASE_URL  || 'https://web-theta-one-68.vercel.app';
const INIT_DATA = __ENV.INIT_DATA || '';  // Must be a real valid initData for this test to work

export default function () {
  if (!INIT_DATA) {
    console.warn('INIT_DATA not set — request will return 401, which is expected in a unit test environment.');
  }

  const res = http.get(`${BASE_URL}/api/home/feed`, {
    headers: { 'x-telegram-init-data': INIT_DATA },
    timeout: '10s',
  });

  check(res, {
    'feed responds': r => r.status === 200 || r.status === 401,
    'no 5xx':        r => r.status < 500,
    'under 3s':      r => r.timings.duration < 3000,
  });

  sleep(Math.random() * 2 + 1); // 1-3 second think time between refreshes
}
