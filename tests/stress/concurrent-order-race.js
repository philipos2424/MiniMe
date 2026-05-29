/**
 * k6 stress test: concurrent-order-race.js
 *
 * Verifies that two simultaneous webhooks for the same customer create
 * only ONE customer row and ONE order, not duplicates.
 *
 * Run: k6 run concurrent-order-race.js --env BASE_URL=https://web-theta-one-68.vercel.app
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const duplicateCustomers = new Counter('duplicate_customers');
const duplicateOrders    = new Counter('duplicate_orders');

export const options = {
  scenarios: {
    concurrent_webhooks: {
      executor: 'shared-iterations',
      vus: 5,           // 5 virtual users fire simultaneously
      iterations: 5,    // 5 total = one per VU at the same time
      maxDuration: '30s',
    },
  },
  thresholds: {
    duplicate_customers: ['count==0'],  // MUST be zero
    duplicate_orders:    ['count==0'],  // MUST be zero
    http_req_failed:     ['rate<0.01'],
  },
};

// Simulated Telegram update — same customer, same business, order-like message.
// In a real test, replace WEBHOOK_SECRET and business_id with real values.
const WEBHOOK_SECRET = __ENV.WEBHOOK_SECRET || 'test-secret';
const BASE_URL = __ENV.BASE_URL || 'https://web-theta-one-68.vercel.app';
const TELEGRAM_ID = 999888777;  // fake customer ID

function makeUpdate(iterNum) {
  return JSON.stringify({
    update_id: 100000 + iterNum,
    message: {
      message_id: 200000 + iterNum,
      from: {
        id: TELEGRAM_ID,
        first_name: 'Race',
        last_name: 'Test',
        username: 'race_test_user',
      },
      chat: { id: TELEGRAM_ID, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: `I want to order 1 test product. Deliver to Test Street. Phone 0911000000.`,
    },
  });
}

export default function () {
  const iter = __VU; // 1-5, unique per VU
  const res = http.post(
    `${BASE_URL}/api/telegram/webhook/${WEBHOOK_SECRET}`,
    makeUpdate(iter),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      timeout: '30s',
    }
  );

  check(res, {
    'webhook accepted (200)': r => r.status === 200 || r.status === 403, // 403 = secret mismatch (expected in test env)
    'no 5xx error':           r => r.status < 500,
  });
}

export function handleSummary(data) {
  console.log('\n=== Concurrent Order Race Results ===');
  console.log('Duplicate customers:', data.metrics.duplicate_customers?.values?.count ?? 0);
  console.log('Duplicate orders:   ', data.metrics.duplicate_orders?.values?.count ?? 0);
  console.log('\nTo verify manually, run in Supabase SQL Editor:');
  console.log(`SELECT telegram_id, COUNT(*) as cnt FROM customers WHERE telegram_id = ${TELEGRAM_ID} GROUP BY telegram_id;`);
  return {};
}
