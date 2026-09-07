/**
 * Legacy Telegram Markdown escaping — the fix for outreach_sends' 6.3%
 * parse-error rate. Business names routinely contain apostrophes,
 * underscores, asterisks, brackets and Amharic script and were being
 * interpolated raw into parse_mode: 'Markdown' messages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapeMarkdown } from '../telegramApi.js';

// outreach-rules/route.js cannot be imported directly here — it pulls in
// 'next/server', which node's ESM loader can't resolve outside the Next
// build (no test in this suite imports a route.js file, for that reason).
// So renderTemplate's escaping behavior is verified two ways: (1) a
// same-shape reimplementation below, sharing the real escapeMarkdown, and
// (2) a source check that the actual renderTemplate wires escapeMarkdown
// around the substituted values only, never the template body.
function renderTemplate(template, business) {
  const first = (business.owner_name || '').split(' ')[0] || 'there';
  return String(template || '')
    .replaceAll('{{owner_name}}', escapeMarkdown(first))
    .replaceAll('{{business_name}}', escapeMarkdown(business.name || 'your shop'));
}

const routeSrc = readFileSync(
  new URL('../../../app/api/cron/outreach-rules/route.js', import.meta.url),
  'utf8'
);

test('escapes each legacy Markdown entity-start character individually', () => {
  assert.equal(escapeMarkdown('_'), '\\_');
  assert.equal(escapeMarkdown('*'), '\\*');
  assert.equal(escapeMarkdown('`'), '\\`');
  assert.equal(escapeMarkdown('['), '\\[');
});

test('does not escape characters legacy Markdown treats as plain text', () => {
  for (const ch of [']', '(', ')', '.', '!', '-']) {
    assert.equal(escapeMarkdown(ch), ch, `should not escape "${ch}"`);
  }
});

test('a realistic Ethiopian shop name with an apostrophe and underscore', () => {
  assert.equal(escapeMarkdown("Abebe's Coffee_Shop"), "Abebe's Coffee\\_Shop");
});

test('Amharic text passes through unchanged', () => {
  const name = 'ሰላም ሱቅ';
  assert.equal(escapeMarkdown(name), name);
});

test('nullish input returns empty string', () => {
  assert.equal(escapeMarkdown(null), '');
  assert.equal(escapeMarkdown(undefined), '');
});

test('non-string input is coerced', () => {
  assert.equal(escapeMarkdown(42), '42');
});

test('renderTemplate keeps template *bold* markup intact while escaping an injected name containing *', () => {
  const template = 'Hi {{owner_name}}, *{{business_name}}* is trending!';
  const business = { owner_name: 'Abebe Tesfaye', name: 'Star*Shop_1' };
  const out = renderTemplate(template, business);
  assert.equal(out, 'Hi Abebe, *Star\\*Shop\\_1* is trending!');
  // the deliberate bold markers around the substitution site survive
  assert.ok(out.includes('*Star\\*Shop\\_1*'));
});

test('renderTemplate falls back to defaults and still escapes them safely', () => {
  const out = renderTemplate('Hi {{owner_name}}, welcome {{business_name}}', {});
  assert.equal(out, 'Hi there, welcome your shop');
});

test('the real renderTemplate in route.js wires escapeMarkdown around the substituted values only', () => {
  const fnMatch = routeSrc.match(/export function renderTemplate\(template, business\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'renderTemplate not found in route.js');
  const fnSrc = fnMatch[0];
  assert.match(fnSrc, /replaceAll\('\{\{owner_name\}\}',\s*escapeMarkdown\(/);
  assert.match(fnSrc, /replaceAll\('\{\{business_name\}\}',\s*escapeMarkdown\(/);
  // the raw template string itself is never passed through escapeMarkdown
  assert.ok(!/^\s*return escapeMarkdown\(/m.test(fnSrc), 'template body must not be blanket-escaped');
});

test('the real route.js imports escapeMarkdown from the shared telegramApi helper', () => {
  assert.match(routeSrc, /import\s*\{\s*escapeMarkdown\s*\}\s*from\s*['"].*telegramApi['"]/);
});

// Task 6 regression: b2b.js, research.js, b2b-follow-up/route.js,
// research-timeout/route.js and ownerCommands.js used to escape the
// MarkdownV2 punctuation set (., !, -, (, ), etc.) and then send with
// parse_mode: 'Markdown' (legacy), which left literal backslashes in
// messages. escapeMarkdown must never touch those characters.
test('a name with . ! - ( ) passes through with no backslashes added', () => {
  const name = 'Addis Trading Co. (Est. 2019) - Wholesale!';
  const out = escapeMarkdown(name);
  assert.equal(out, name);
  assert.ok(!out.includes('\\'), 'no backslashes should be introduced');
});

test('_, *, backtick and [ are still escaped', () => {
  const out = escapeMarkdown('_*`[');
  assert.equal(out, '\\_\\*\\`\\[');
});

test('a realistic supplier name with mixed punctuation and Amharic', () => {
  const name = "Kebede & Sons (Import-Export) — ሰላም ንግድ ድርጅት, Ltd.";
  const out = escapeMarkdown(name);
  assert.equal(out, name);
  assert.ok(!out.includes('\\'), 'no backslashes should be introduced');
});
