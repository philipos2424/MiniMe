# MiniMe Stress Tests

**Tool:** [k6](https://k6.io/) — install with `brew install k6` or see https://k6.io/docs/get-started/installation/

## Setup

```bash
# Install k6
brew install k6     # macOS
# or
winget install k6   # Windows

# Copy and fill in your values
cp .env.example .env
```

## Test Suite

| Script | What it tests | Duration |
|---|---|---|
| `webhook-flood.js` | 50 businesses × 10 customers, 1 msg/min | 10 min |
| `dashboard-burst.js` | 20 owners refreshing dashboard simultaneously | 5 min |
| `broadcast-storm.js` | One business broadcast to 500 customers | ~3 min |
| `concurrent-order-race.js` | Same customer sends 5 order messages in 100ms | 30 sec |
| `auth-attacks.js` | Timing attacks, replay attacks, invalid tokens | 2 min |

## Running

```bash
# Run a single test
k6 run webhook-flood.js --env BASE_URL=https://web-theta-one-68.vercel.app

# Run all tests and save results
k6 run webhook-flood.js --out json=results/webhook-flood.json
k6 run dashboard-burst.js --out json=results/dashboard-burst.json

# View summary
k6 run webhook-flood.js --summary-export=results/summary.json
```

## Acceptance Criteria

- ✅ p95 response time < 15s for bot replies
- ✅ 0 duplicate customers or orders
- ✅ 0 unhandled 5xx errors
- ✅ Rate limiting enforced after cold start
- ✅ Sub-admin blocked from destructive endpoints
- ✅ Timing-safe webhook verification holds under parallel requests
