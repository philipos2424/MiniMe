/**
 * /settings/modes was an older second "Settings" page that duplicated the
 * grouped menu and had a Pause button writing notification_prefs.bot_enabled,
 * which nothing reads. It is now the Secretary Mode page only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
// Code only: the page's doc comment names the removed cards on purpose.
const page = readFileSync(`${root}apps/web/src/app/(dashboard)/settings/modes/page.js`, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('no fake pause toggle', () => {
  assert.doesNotMatch(page, /bot_enabled/);
});

test('no duplicate settings cards', () => {
  for (const dup of ['Edit Profile', 'Chat Automation', 'Enter MiniMe', 'href="/settings/trust"', 'href="/settings/hours"', 'href="/settings/character"']) {
    assert.ok(!page.includes(dup), dup);
  }
});

test('titled Secretary Mode, with real radios and connect steps', () => {
  assert.match(page, />\s*Secretary Mode\s*</);
  assert.match(page, /role="radio"/);
  assert.doesNotMatch(page, /'● '|'○ '/);
  assert.match(page, /Business<\/strong>, then <strong>Chatbots/);
});
