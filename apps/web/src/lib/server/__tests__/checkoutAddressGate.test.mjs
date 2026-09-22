/**
 * tryCheckout()'s hasPhoneOrAddress gate (replyEngine.js) — the fast-path
 * order short-circuit refused to fire unless the message "looked like" it
 * had a phone or address. The test was English/Latin-only on a platform
 * where customers write Amharic script, and the phone test required 7+
 * *consecutive* digits, which no real Ethiopian phone format has once you
 * write it with spaces, dashes, or a +251 prefix. Both defects independently
 * discard real orders — see task-7-brief.md for the zero-orders-in-60-days
 * evidence.
 *
 * replyEngine.js can't be imported directly here — it uses extensionless
 * specifiers ('./openaiClient', './db', ...) that only the Next bundler
 * resolves (same reason b2b.test.mjs and replyEngine.test.mjs assert
 * against source text). Rather than hand-retyping the regex/helper here —
 * which is exactly the kind of copy that silently drifts from the real code
 * or introduces a typo'd Amharic spelling nobody would catch — this test
 * extracts the *actual* declarations out of the source text and evaluates
 * them, so it exercises the real regex objects and the real helper
 * function, not a reimplementation of them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = readFileSync(`${root}apps/web/src/lib/server/replyEngine.js`, 'utf8');

function extractConst(name) {
  const m = src.match(new RegExp(`const ${name} = (.+);`));
  assert.ok(m, `expected to find "const ${name} = ...;" in replyEngine.js`);
  // eslint-disable-next-line no-new-func -- evaluating a regex literal pulled
  // verbatim from the source under test, not arbitrary/untrusted input.
  return new Function(`return (${m[1]});`)();
}

function extractFunction(name) {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `expected to find "function ${name}(...) { ... }" in replyEngine.js`);
  // eslint-disable-next-line no-new-func -- same rationale as extractConst.
  return new Function(`${m[0]}; return ${name};`)();
}

const ADDRESS_HINTS = extractConst('ADDRESS_HINTS');
const ADDRESS_HINTS_AM = extractConst('ADDRESS_HINTS_AM');
const hasEnoughDigitsForPhone = extractFunction('hasEnoughDigitsForPhone');

function hasPhoneOrAddress(text) {
  return hasEnoughDigitsForPhone(text) || ADDRESS_HINTS.test(text) || ADDRESS_HINTS_AM.test(text);
}

test('ADDRESS_HINTS and ADDRESS_HINTS_AM are declared beside the other hint pairs', () => {
  assert.match(src, /const ADDRESS_HINTS = /);
  assert.match(src, /const ADDRESS_HINTS_AM = /);
  // The old inline, English-only, 7-digit test must be gone.
  assert.doesNotMatch(src, /\\b\\d\{7,\}\\b\|\\bbole\\b/);
});

test('tryCheckout wires the gate through the phone check OR both address hint sets', () => {
  assert.match(
    src,
    /const hasPhoneOrAddress = hasEnoughDigitsForPhone\(incomingText\) \|\| ADDRESS_HINTS\.test\(incomingText\) \|\| ADDRESS_HINTS_AM\.test\(incomingText\);/
  );
});

// Amharic-script address terms (አድራሻ/ያደርሳል/ማድረስ/ይደርሳል) — the exact tokens
// already vetted for NEEDS_BRAIN_RE at replyEngine.js ~line 7093.
test('Amharic-script address words match', () => {
  assert.equal(hasPhoneOrAddress('አድራሻዬ ቦሌ ነው'), true);
  assert.equal(hasPhoneOrAddress('ያደርሳል?'), true);
  assert.equal(hasPhoneOrAddress('ወደ ቤቴ ማድረስ ትችላላችሁ?'), true);
  assert.equal(hasPhoneOrAddress('ይደርሳል'), true);
});

test('Latin transliteration ("adrasha") matches', () => {
  assert.equal(hasPhoneOrAddress('adrasha lay yaderesal'), true);
});

test('formatted phone numbers with 9+ digits match despite spaces/dashes/+251', () => {
  assert.equal(hasPhoneOrAddress('call me on 0911 23 45 67'), true);
  assert.equal(hasPhoneOrAddress('+251 911 234 567'), true);
  assert.equal(hasPhoneOrAddress('0911-234-567'), true);
});

test('a bare 4-digit fragment like "0911" alone does not match', () => {
  assert.equal(hasPhoneOrAddress('0911'), false);
});

test('an English address ("deliver to Bole") still matches — no regression', () => {
  assert.equal(hasPhoneOrAddress('please deliver to Bole'), true);
});

test('a plain question with no address and no phone returns false', () => {
  assert.equal(hasPhoneOrAddress('do you have this in blue?'), false);
});
