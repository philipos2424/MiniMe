/**
 * Research Agent partner resolution (resolvePartnerReference).
 *
 * Regression: past-partner candidates ("find me my usual supplier") were
 * filtered down to businesses with a dedicated bot token, so a partner on
 * the shared @MiniMeAgentBot (shop_code tenant, no telegram_bot_token_enc)
 * could never be recontacted through research even after real deal history.
 *
 * research.js can't be imported here (extensionless specifiers only the Next
 * bundler resolves), so this asserts against the source the way the other
 * DB-touching modules' tests do (see sendNudge.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = readFileSync(`${root}apps/web/src/lib/server/research.js`, 'utf8');

test('resolvePartnerReference selects the columns needed to resolve a shared-bot fallback token', () => {
  for (const col of ['owner_private_chat_id', 'telegram_bot_token_enc', 'shop_code', 'onboarding_completed']) {
    assert.match(src, new RegExp(col), `select() is missing "${col}"`);
  }
});

test('a past partner qualifies with their own bot OR the shared bot (shop_code + onboarding_completed)', () => {
  assert.match(src, /p\.telegram_bot_token_enc \|\| \(p\.shop_code && p\.onboarding_completed\)/);
});
