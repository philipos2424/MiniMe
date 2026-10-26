/**
 * One save pattern (audit, Oct 2026): every settings page that saves typed
 * input uses <SaveBar> with real change tracking, so it reads "No changes"
 * until something is edited. SaveBar's dirty now defaults to false, so a page
 * that forgets to pass it can't show an always-active Save.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

const settingsDir = new URL('app/(dashboard)/settings/', root);
const pages = readdirSync(settingsDir)
  .map(d => `app/(dashboard)/settings/${d}/page.js`)
  .filter(p => existsSync(new URL(p, root)));

test('SaveBar defaults to clean and hides "Saved" once something changes', () => {
  const bar = read('components/ui/SaveBar.jsx');
  assert.match(bar, /export default function SaveBar\(\{ dirty = false,/);
  assert.match(bar, /\{saved && !dirty && !saving && \(/);
  assert.match(bar, /export function useUnsavedChanges\(value\)/);
});

test('every SaveBar on a settings page passes real change tracking', () => {
  const users = pages.filter(p => /<SaveBar\b/.test(read(p)));
  assert.ok(users.length >= 8, `expected the converted pages, found ${users.length}`);
  for (const p of users) {
    for (const tag of read(p).match(/<SaveBar\b[^>]*\/>/g)) {
      assert.match(tag, /\bdirty=\{/, `${p}: ${tag}`);
    }
  }
});

test('no inline per-field Save buttons left on Personality or Search', () => {
  assert.doesNotMatch(read('app/(dashboard)/settings/character/page.js'), /'Save changes'\}\s*<\/button>/);
  const search = read('app/(dashboard)/settings/search/page.js');
  assert.doesNotMatch(search, /taglineSaved \? '✓ Saved' : 'Save'/);
  assert.match(search, /if \(!r\.ok\) throw new Error\('save_failed'\)/);
});
