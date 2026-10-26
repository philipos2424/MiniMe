/**
 * Navigation fixes (audit, Oct 2026): one Telegram Back handler, scroll
 * restored on Back, Settings tab lit on its pages outside /settings, and tab
 * taps that can't be swallowed by a throwing onClick.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTabActive, parentPath } from '../../navSections.mjs';

const src = fileURLToPath(new URL('../../../', import.meta.url));
const read = p => readFileSync(join(src, p), 'utf8').replace(/\r\n/g, '\n');

test('Settings tab stays lit on Settings pages that live elsewhere', () => {
  for (const p of ['/settings', '/settings/payments', '/teach', '/agent/team', '/b2b', '/assistant']) {
    assert.equal(isTabActive('/settings', p), true, p);
  }
  assert.equal(isTabActive('/settings', '/conversations'), false);
  assert.equal(isTabActive('/', '/settings'), false);
  assert.equal(isTabActive('/', '/'), true);
  assert.equal(isTabActive('/advisor', '/advisor/teach'), true);
});

test('Back without history goes to the parent, Settings pages to Settings', () => {
  assert.equal(parentPath('/agent/team'), '/settings');
  assert.equal(parentPath('/teach'), '/settings');
  assert.equal(parentPath('/settings/payments'), '/settings');
  assert.equal(parentPath('/conversations/abc'), '/conversations');
  assert.equal(parentPath('/orders'), '/');
  assert.equal(parentPath('/'), '/');
});

test('no page under (dashboard) registers its own Telegram BackButton', () => {
  const walk = d => readdirSync(d).flatMap(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : (/\.(js|jsx)$/.test(n) ? [p] : []);
  });
  const offenders = walk(join(src, 'app/(dashboard)'))
    .filter(f => /BackButton\.onClick|bb\.onClick/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('the shell owns Back, restores scroll, and the header knows /progress is a tab', () => {
  const shell = read('components/layout/DashboardShell.jsx');
  assert.match(shell, /if \(window\.history\.length > 1\) router\.back\(\);\n\s+else router\.push\(parentPath\(pathname\)\);/);
  assert.match(shell, /<main ref=\{setMain\}/);
  assert.match(shell, /cameByHistory\.current \? \(SCROLL_POSITIONS\.get\(pathname\) \|\| 0\) : 0/);
  assert.match(shell, /const TABS = \['\/', '\/conversations', '\/advisor', '\/progress'/);
});

test('tab taps cannot throw before navigating', () => {
  const nav = read('components/layout/MobileNav.jsx');
  assert.match(nav, /try \{ sessionStorage\.setItem\('_navigated', '1'\); \} catch \{\}/);
  assert.doesNotMatch(nav, /onClick=\{\(\) => \{ sessionStorage/);
  assert.match(nav, /touchAction: 'manipulation'/);
});
