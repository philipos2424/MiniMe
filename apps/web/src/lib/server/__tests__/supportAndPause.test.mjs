/**
 * Support & Help used to open the AI assistant with no FAQ and no way to reach
 * a person. And /pause set brain_mode=false, which left the photo, document
 * and legacy reply paths answering customers: panic_mode is the real switch.
 * Source-text tests: these modules need the full runtime to import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const engine = read('../replyEngine.js');

test('/pause and /panic set panic_mode; /resume clears it', () => {
  const pause = engine.slice(engine.indexOf("if (msg.text.startsWith('/pause') || msg.text.startsWith('/panic'))"));
  assert.ok(pause.length > 0, '/panic is handled');
  assert.match(pause.slice(0, 400), /update\(\{ panic_mode: true, panic_activated_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.doesNotMatch(pause.slice(0, 400), /brain_mode: false/);
  const resume = engine.slice(engine.indexOf("if (msg.text.startsWith('/resume'))"));
  assert.match(resume.slice(0, 300), /panic_mode: false/);
});

test('panic_mode still stops customer replies before any reply path', () => {
  const inner = engine.slice(engine.indexOf('async function handleTenantUpdateInner'));
  const gate = inner.indexOf('if (business.panic_mode) return;');
  assert.ok(gate > 0);
  for (const path of ['PRODUCT PHOTO FAST PATH', 'tryAutoSendDocument(token', 'runBrain(']) {
    const at = inner.indexOf(path);
    if (at > 0) assert.ok(gate < at, `${path} runs after the panic gate`);
  }
});

test('/status reports paused from panic_mode', () => {
  assert.match(engine, /const isActive {5}= !business\.panic_mode;/);
});

test('Settings has a real Pause / Resume and Support points at the new page', () => {
  const settings = read('../../../components/pages/SettingsPage.jsx');
  assert.match(settings, /updateBusiness\(initData, \{ panic_mode: next/);
  assert.match(settings, /href: '\/settings\/support'/);
  assert.doesNotMatch(settings, /href: '\/assistant',\s+Icon: MessageCircle, label: 'Support & Help'/);
});

test('Support page: FAQ from plan constants, and a message box that reaches a person', () => {
  const page = read('../../../app/(dashboard)/settings/support/page.js');
  assert.match(page, /FREE_LIMITS\.aiRepliesPerMonth/);
  assert.match(page, /PRO_PRICE_ETB/);
  assert.match(page, /page: 'support'/);
  assert.match(page, /aria-expanded=\{isOpen\}/);
  assert.doesNotMatch(page, /<details/, 'no unstyled native disclosure');
});

test('support requests alert the admin reliably, with a way to reply', () => {
  const api = read('../../../app/api/platform/feedback/route.js');
  const support = api.slice(api.indexOf("page === 'support'"), api.indexOf('} else if (adminId && botToken)'));
  assert.match(support, /await fetch\(/);
  assert.match(support, /parse_mode: 'HTML'/);
  assert.match(support, /tg:\/\/user\?id=/);
  assert.match(support, /esc\(note\)/);
});
