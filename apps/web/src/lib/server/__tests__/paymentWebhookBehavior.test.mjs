import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scenarios = {
  unsigned: 'rejects unsigned requests before database access',
  'bad-signature': 'rejects invalid Stripe signatures before database access',
  'expired-signature': 'rejects valid but expired Stripe signatures',
  paid: 'fulfills only the stored tenant and plan despite conflicting signed metadata',
  mismatch: 'refuses a signed payment with the wrong amount',
  duplicate: 'does not notify again after duplicate fulfillment',
  'read-failure': 'returns retryable failure when purchase lookup fails',
  'grant-failure': 'returns retryable failure when atomic fulfillment fails',
};
for (const [scenario, description] of Object.entries(scenarios)) {
  test(`payment webhook ${description}`, () => {
    const child = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('./fixtures/paymentWebhook.mjs', import.meta.url)), scenario], { encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.error?.message || child.stderr || child.stdout);
  });
}
