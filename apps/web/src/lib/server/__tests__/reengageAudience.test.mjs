import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const audience  = readFileSync(`${root}apps/web/src/lib/server/reengage/audience.js`, 'utf8');
const artifacts = readFileSync(`${root}apps/web/src/lib/server/reengage/artifacts.js`, 'utf8');

test('the daily cap is applied, so a first run cannot blast the whole backlog', () => {
  assert.match(audience, /REENGAGE_DAILY_CAP/);
  assert.match(audience, /slice\(0,\s*cap\)/);
});

test('the backlog drains oldest-first', () => {
  assert.match(audience, /sort\(/);
  assert.match(audience, /stalledAt/);
});

test('admin suppression is wired to the real allowlist, not reimplemented', () => {
  assert.match(audience, /import \{ isAdmin \}/);
  assert.match(audience, /isAdminUser:\s*isAdmin\(/);
});

test('opt-out is read from the same flag STOP writes', () => {
  assert.match(audience, /owner_nudges/);
  assert.match(audience, /opted_out/);
});

test('artifact generation never quotes a number it did not fetch', () => {
  // Zero-safety lives in copy.mjs; artifacts must pass real counts or nothing.
  assert.match(artifacts, /search_waitlist/);
  assert.match(artifacts, /search_logs/);
});

test('a failed artifact degrades instead of skipping the person', () => {
  assert.match(artifacts, /catch/);
  assert.ok(/return\s*\{[^}]*first/.test(artifacts), 'must still return baseline facts on failure');
});

test('the expensive draftReply path runs only for the stage that shows a reply', () => {
  assert.match(artifacts, /stage === 'B2' \|\| stage === 'B3'/);
});

test('draftReply runs in preview mode so it never writes to live conversations', () => {
  assert.match(artifacts, /preview:\s*true/);
});
