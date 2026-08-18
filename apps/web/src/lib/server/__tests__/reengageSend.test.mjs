import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const send  = readFileSync(`${root}apps/web/src/lib/server/reengage/send.js`, 'utf8');
const route = readFileSync(`${root}apps/web/src/app/api/cron/reengagement/route.js`, 'utf8');
const vercel = readFileSync(`${root}apps/web/vercel.json`, 'utf8');

test('the old nudge cron is gone, so nobody is messaged twice', () => {
  assert.ok(!existsSync(`${root}apps/web/src/app/api/cron/onboarding-nudges/route.js`));
  assert.ok(!/onboarding-nudges/.test(vercel), 'vercel.json still schedules the old cron');
});

test('the new cron is scheduled in the evening EAT, not mid-afternoon', () => {
  const cfg = JSON.parse(vercel);
  const cron = cfg.crons.find(c => c.path === '/api/cron/reengagement');
  assert.ok(cron, 'reengagement cron not registered');
  // 17:00 UTC = 20:00 EAT. 11:00 UTC (the old slot) was 2pm EAT, mid-trading.
  assert.equal(cron.schedule, '0 17 * * *');
});

test('the route refuses unauthorized callers', () => {
  assert.match(route, /isCronAuthorized/);
  assert.match(route, /401/);
});

test('dry run sends nothing', () => {
  assert.match(route, /dry_run/);
  assert.match(route, /if \(dryRun\)/);
});

test('a Telegram 403 permanently opts that person out', () => {
  assert.match(send, /403/);
  assert.match(send, /opted_out/);
});

test('every send is recorded for attribution before we can forget it', () => {
  assert.match(send, /reengagement_sends/);
  assert.match(send, /insert/);
  assert.match(send, /variant/);
  assert.match(send, /stage/);
});

test('one failed recipient never aborts the run', () => {
  assert.match(route, /try\s*\{/);
  assert.match(route, /catch/);
});

test('the run is audited, matching the cron it replaces', () => {
  assert.match(route, /audit\(/);
  assert.match(route, /reengagement\.run/);
});
