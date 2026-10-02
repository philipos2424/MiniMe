import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const tool of ['reply_to_client', 'ask_client_question']) {
  for (const scenario of ['sent', 'rejected', 'unknown', 'partial', 'unknown-audit-error']) {
    test(`${tool} observes ${scenario} delivery through the real brain loop`, () => {
      const child = spawnSync(process.execPath, [
        '--experimental-vm-modules', fileURLToPath(new URL('./fixtures/agentDelivery.mjs', import.meta.url)), tool, scenario,
      ], { encoding: 'utf8', timeout: 15000 });
      assert.equal(child.status, 0, child.error?.message || child.stderr || child.stdout);
    });
  }
}
