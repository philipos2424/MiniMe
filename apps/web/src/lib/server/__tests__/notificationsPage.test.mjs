/**
 * "What pings me" moved out of Morning Digest onto its own Notifications page.
 * The settings API now saves each half only when its fields are sent, and
 * reports silent_drafts the way notifyOwnerDraft reads it (explicit true).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const route = read('../../../app/api/settings/notifications/route.js');

test('GET reports silent_drafts as the server applies it', () => {
  assert.match(route, /silent_drafts: business\.notification_prefs\?\.silent_drafts === true,/);
  assert.doesNotMatch(route, /silent_drafts \?\? true/);
  assert.match(read('../notification.js'), /const silentMode = business\.notification_prefs\?\.silent_drafts === true;/);
});

test('a Notifications save does not touch the Morning Digest', () => {
  assert.match(route, /if \('enabled' in body \|\| 'hour' in body \|\| 'format' in body\)/);
  assert.match(route, /cur\.enabled !== false/);
});

test('the Notifications page owns "What pings me"; Morning Digest no longer has it', () => {
  const alerts = read('../../../app/(dashboard)/settings/alerts/page.js');
  assert.match(alerts, /body: JSON\.stringify\(\{ silent_drafts: v \}\)/);
  assert.match(alerts, /role="radio"/);
  // Code only: the page's doc comment says where the setting moved.
  const digest = read('../../../app/(dashboard)/settings/notifications/page.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(digest, /silent_drafts|What pings me/);
  assert.match(digest, />\s*Morning Digest\s*</);
  // Only the digest's own fields (the form snapshot may be named cfg or sent).
  assert.match(digest, /body: JSON\.stringify\(\{ enabled: (cfg|sent)\.enabled, hour: \1\.hour, format: \1\.format \}\)/);
});

test('Settings lists Notifications next to Morning Digest', () => {
  assert.match(read('../../../components/pages/SettingsPage.jsx'), /href: '\/settings\/alerts',\s+Icon: Bell,\s+label: 'Notifications'/);
});
