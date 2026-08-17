/**
 * replyEngine.js's B2B callback handlers. Can't be imported directly here
 * (extensionless specifiers only the Next bundler resolves — same reason
 * b2b.js and research.js get source-text tests, see b2b.test.mjs), so this
 * asserts against the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = readFileSync(`${root}apps/web/src/lib/server/replyEngine.js`, 'utf8');

// Regression: tapping "negotiate with the winner" on a research report used
// to silently set b2b_auto_negotiate = true — the owner never asked for
// autonomy, they tapped a button to start a conversation. Autonomy now comes
// only from the b2b_autonomy setting the owner explicitly picked in /b2b.
test('campaign_negotiate no longer silently flips b2b_auto_negotiate to true', () => {
  const fn = src.match(/if \(action === 'campaign_negotiate'\) \{[\s\S]*?\n {6}\}\n\n {6}if \(action ===/)?.[0]
    || src.slice(src.indexOf("action === 'campaign_negotiate'"));
  assert.doesNotMatch(fn, /b2b_auto_negotiate: true/);
  assert.match(fn, /getB2BAutonomy/);
  assert.match(fn, /describeB2BAutonomy/);
});

// Two "not a fit"/"deal approval" callbacks need no free-typing at all —
// the genuinely one-tap actions this session added.
test('notfit and deal-approval callbacks resolve without requiring the owner to type anything', () => {
  assert.match(src, /if \(action === 'notfit'\) \{/);
  assert.match(src, /if \(action === 'dealok' \|\| action === 'dealno'\) \{/);
  // The cached offer is cleared on tap so a replayed callback can't re-fire it.
  assert.match(src, /delete remaining\[id\];/);
});

// ── Context & language regressions (2026-08) ────────────────────────────────
//
// From an owner: "the bot should be responsive understanding overall context
// but now the bot seems predefined. And also the bot didn't understand very
// well Amharic English text eg. Nege emetalehu."

// buildTinyReply() answered any message opening with hi/hello/selam from a
// hardcoded string, before any model call — no history, no language match, and
// its text was one of the bot tells the system prompt itself forbids. It opened
// nearly every conversation on the platform. Greetings now go through the fast
// path like everything else.
test('no hardcoded greeting short-circuits the reply path', () => {
  assert.doesNotMatch(src, /function buildTinyReply/,
    'buildTinyReply must stay deleted — it is what made the bot feel predefined');
  assert.doesNotMatch(src, /'rule-tiny-reply'/,
    'no reply should be attributed to a rule-based greeting generator');
  // The literal string, in case it comes back under a different name.
  assert.doesNotMatch(src, /How can I help\?`/,
    'canned "How can I help?" replies must not be constructed in code');
});

// The fast path handles ~70% of traffic. It used to see only the last 10
// messages and nothing about the customer, so every reply restarted cold.
test('the fast path gets the same customer context the slow path has', () => {
  const fast = src.slice(src.indexOf('── FAST PATH'), src.indexOf('FAST PATH DONE'));
  assert.match(fast, /listCustomerMemory\(customer\.id/,
    'fast path must know what it remembers about this customer');
  assert.match(fast, /getCustomerOrderHistory\(customer\.id/,
    'fast path must know what this customer has bought before');
  assert.match(fast, /getRecentMessages\(conversation\.id, 20\)/,
    'fast path history window must not shrink back to 10');
  // Customer-sourced memory is data, never instructions.
  assert.match(fast, /ignore \(previous\|all\|above\|system\|instructions\)/,
    'customer memory must be injection-scrubbed before it enters the prompt');
});

// Every prompt that talks to a customer must carry the script rules; before
// this, only the slow path did, so most Amharic traffic never saw them.
test('every reply prompt carries the per-message language block', () => {
  assert.match(src, /function buildLanguageBlock/);
  // Slow path: appended to the volatile block so it stays out of the cached prefix.
  assert.match(src, /volatileBlock \+= buildLanguageBlock\(incomingText\)/);
  // Fast path: computed once, and used by all three prompt variants.
  assert.match(src, /const fastLanguageBlock = buildLanguageBlock\(msg\.text\)/);
  const fast = src.slice(src.indexOf('── FAST PATH'), src.indexOf('FAST PATH DONE'));
  assert.equal((fast.match(/\$\{fastLanguageBlock\}/g) || []).length, 3,
    'all three fast-path prompt variants (personal, secretary, bot) need it');
});

// Addis AI returns ፊደል. Running it over a reply to "nege emetalehu" would
// answer in a script the customer deliberately didn't use.
test('the Amharic polish stays gated on Ethiopic script, not on "is Amharic"', () => {
  assert.match(src, /if \(isAmharic\(incomingText\) && draft\)/,
    'polish gate must use the narrow Ethiopic test');
  assert.match(src, /function isAmharic\(text\) \{ return hasEthiopic\(text\); \}/,
    'isAmharic must remain the narrow ፊደል test, not a general Amharic test');
});

// Amharic word order puts the object first and the verb last, so a
// verb-then-noun pattern missed every Amharic file request.
test('file requests match Amharic word order in both scripts', () => {
  // The parts are JS string literals in the source, so \\b on disk is one \b
  // once the string is evaluated — undo that escaping before rebuilding the regex.
  const unescape = s => s.replace(/\\\\/g, '\\');
  const verb = unescape(src.match(/const FILE_ASK_VERB = '(.*)';/)[1]);
  const noun = unescape(src.match(/const FILE_ASK_NOUN = '(.*)';/)[1]);
  const re = new RegExp(`${verb}.{0,30}${noun}|${noun}.{0,30}${verb}`, 'i');
  for (const text of ['send me the menu', 'menu lakelign', 'ዋጋ ዝርዝር ላክልኝ', 'ካታሎግ ላኩልኝ']) {
    assert.ok(re.test(text), `${JSON.stringify(text)} must be seen as a file request`);
  }
  for (const text of ['nege emetalehu', 'do you deliver to bole', 'how much is the dress']) {
    assert.ok(!re.test(text), `${JSON.stringify(text)} must NOT be seen as a file request`);
  }
});

// An order, address, or payment written in Amharic used to be answered by the
// chatty fast path with no tools — no order created, no invoice, no address.
test('Amharic order/payment/delivery intent routes to the brain', () => {
  const block = src.slice(src.indexOf('const NEEDS_BRAIN_RE'), src.indexOf('// Price/availability questions'));
  for (const probe of ['እፈልጋለሁ', 'ክፍያ', 'አድራሻ', 'ሰርዝ', 'efelgalehu', 'kifiya', 'adrasha', 'sereze']) {
    assert.ok(block.includes(probe), `NEEDS_BRAIN_RE must cover ${probe}`);
  }
  // \b is ASCII-only in JS — it never matches beside an Ethiopic letter.
  for (const line of block.split('\n')) {
    if (/[ሀ-፿]/.test(line)) {
      assert.ok(!line.includes('\b'),
        `Ethiopic alternatives must not sit inside \b groups: ${line.trim()}`);
    }
  }
});
