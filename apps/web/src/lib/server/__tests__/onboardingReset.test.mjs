import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resetDecision, isLiveShop, RESET_CONFIRM } from '../onboardingReset.mjs';

const shared = { id: 'b1', bot_mode: 'shared', shop_code: 'abc', onboarding_completed: true, telegram_bot_username: null };
const custom = { id: 'b2', bot_mode: 'custom', telegram_bot_username: 'MyShopBot', telegram_bot_token_enc: 'enc', onboarding_completed: true };

test('a shop with conversations is live and is not reset without confirm', () => {
  const d = resetDecision(shared, { conversationCount: 182 });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'live_shop_needs_confirm');
});

test('a linked custom bot is live even with no conversations', () => {
  assert.equal(isLiveShop(custom), true);
  assert.equal(resetDecision(custom).allowed, false);
});

test('confirmed reset of a live shop keeps bot_mode and bot username', () => {
  const d = resetDecision(custom, { conversationCount: 5, confirm: RESET_CONFIRM });
  assert.equal(d.allowed, true);
  assert.deepEqual(d.updates, { onboarding_completed: false });
  assert.ok(!('bot_mode' in d.updates));
  assert.ok(!('telegram_bot_username' in d.updates));
});

test('an unused shop can start completely fresh', () => {
  const d = resetDecision({ id: 'b3', bot_mode: 'custom' }, { conversationCount: 0, productCount: 0 });
  assert.equal(d.allowed, true);
  assert.equal(d.updates.bot_mode, null);
  assert.equal(d.updates.telegram_bot_username, null);
});

test('Settings sign-out never calls the onboarding reset route', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../components/pages/SettingsPage.jsx', import.meta.url)), 'utf8');
  const start = src.indexOf('async function handleSignOut');
  const end = src.indexOf('\n  }\n', start);
  const body = src.slice(start, end);
  assert.ok(start > 0, 'handleSignOut exists');
  assert.ok(!body.includes('/api/onboarding/reset'), 'sign-out must not reset onboarding');
});
