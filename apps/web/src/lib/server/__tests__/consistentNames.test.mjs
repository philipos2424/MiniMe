/**
 * One name per thing (audit, Oct 26 2026):
 *  - Trust & Autonomy (not "Trust Controls" / "Trust Level")
 *  - MiniMe Search for the shop's listing; MiniMe Market is the separate
 *    shopping Mini App and keeps its name
 *  - trust levels are not plan tiers
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('Trust & Autonomy everywhere it is titled', () => {
  assert.match(read('app/(dashboard)/settings/trust/page.js'), />Trust &amp; Autonomy<\/h1>/);
  assert.match(read('components/pages/SettingsPage.jsx'), /label: 'Trust & Autonomy'/);
});

test('the listing is called MiniMe Search in the menu and on its page', () => {
  const menu = read('components/pages/SettingsPage.jsx');
  assert.match(menu, /href: '\/settings\/search',\s+Icon: Search,\s+label: 'MiniMe Search Listing'/);
  assert.doesNotMatch(menu, /MiniMe Market Listing/);
  assert.match(read('app/(dashboard)/settings/search/page.js'), /MiniMe Search\n/);
});

test('Partners no longer calls a trust level a plan tier', () => {
  const b2b = read('app/(dashboard)/b2b/page.js');
  assert.doesNotMatch(b2b, /plan tier/);
  assert.match(b2b, /set to Trusted or Full Agent/);
});
