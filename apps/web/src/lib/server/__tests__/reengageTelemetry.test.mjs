import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const track = readFileSync(`${root}apps/web/src/app/api/onboarding/track/route.js`, 'utf8');
const webhook = readFileSync(`${root}apps/web/src/app/api/agent-bot/webhook/route.js`, 'utf8');

test('tour steps the wizard actually fires are accepted, not dropped', () => {
  for (const step of ['tour_started', 'tour_finished', 'tour_skipped']) {
    assert.match(track, new RegExp(`'${step}'`), `${step} missing from VALID_STEPS`);
  }
});

test('the silently no-op funnel_events path is gone', () => {
  assert.ok(!/funnel_events/.test(webhook), 'funnel_events writes still present');
  assert.ok(!/logFunnel/.test(webhook), 'logFunnel helper still present');
});
