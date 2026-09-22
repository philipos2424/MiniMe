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
  assert.match(fast, /getRecentMessages\(conversation\.id, 60\)/,
    'fast path history window must not shrink back');
  assert.match(fast, /fetchPastConversationDigests\(/,
    'earlier threads with the same customer must be visible here too');
  // Customer-sourced memory is data, never instructions.
  assert.match(fast, /ignore \(previous\|all\|above\|system\|instructions\)/,
    'customer memory must be injection-scrubbed before it enters the prompt');
});

// The memory hole, and the reason a chatty conversation had no memory at all:
// extractAndSaveCustomerFacts and ensureRollingSummary were called ONLY from
// draftReply, which the fast path never calls. So the path that answers most
// messages read memory and never wrote any — past its window, nothing had ever
// been written down to fall back on.
test('both reply paths write what they learn, through one shared helper', () => {
  assert.match(src, /export async function recordTurnMemory/,
    'one helper, so the two paths cannot drift apart again');

  const fast = src.slice(src.indexOf('── FAST PATH'), src.indexOf('FAST PATH DONE'));
  assert.match(fast, /recordTurnMemory\(\{/,
    'the fast path must record what it learned — this is the whole memory fix');

  // And the slow path goes through the same helper rather than its own calls.
  assert.doesNotMatch(src, /if \(!preview\) extractAndSaveCustomerFacts\(/,
    'fact extraction must not be called directly from draftReply any more');

  // Everything the helper is responsible for.
  const helper = src.slice(src.indexOf('export async function recordTurnMemory'),
    src.indexOf('async function rememberCustomerScript'));
  assert.match(helper, /extractAndSaveCustomerFacts\(/);
  assert.match(helper, /ensureRollingSummary\(/);
  assert.match(helper, /updateThreadState\(/);

  // The summary, the thread state and the remembered script all read-modify-write
  // the same conversations.metadata JSONB column. Run concurrently they clobber
  // each other and the last write wins — which would silently drop the summary
  // this change exists to produce. They must stay sequential.
  const summaryAt = helper.indexOf('await ensureRollingSummary(');
  const stateAt = helper.indexOf('await updateThreadState(');
  const scriptAt = helper.indexOf('await rememberCustomerScript(');
  assert.ok(summaryAt > -1 && stateAt > summaryAt && scriptAt > stateAt,
    'the three conversations.metadata writers must be awaited in sequence, not raced');
});

// Knowing what the conversation is in the middle of is separate from having the
// transcript: "otp negeregn" → "218897" → "is it complete?" is only readable if
// something carries "waiting on an OTP" between turns.
test('both reply paths carry the thread state and what was already said', () => {
  assert.match(src, /volatileBlock \+= renderThreadState\(/,
    'slow path: where the conversation stands');
  assert.match(src, /volatileBlock \+= buildContinuityBlock\(recent\)/,
    'slow path: what has already been said');

  const fast = src.slice(src.indexOf('── FAST PATH'), src.indexOf('FAST PATH DONE'));
  assert.match(fast, /const fastThreadState = renderThreadState\(/);
  assert.match(fast, /const fastContinuity = buildContinuityBlock\(fastRecent\)/);
  assert.equal((fast.match(/\$\{fastThreadState\}\$\{fastContinuity\}/g) || []).length, 3,
    'all three fast-path prompt variants need both blocks');
});

// The bot-mode fast prompt had no memory rules at all — the "do not re-greet,
// do not re-ask" instructions existed only in the slow prompt, which is not the
// one that produced the transcript full of repeated "ሰላም! 👋" openers.
test('the bot-mode fast prompt tells the model not to repeat itself', () => {
  const fast = src.slice(src.indexOf('── FAST PATH'), src.indexOf('FAST PATH DONE'));
  assert.match(fast, /# MEMORY & CONTEXT/);
  assert.match(fast, /Do NOT greet someone you have already greeted/);
  assert.match(fast, /Do NOT re-ask anything they already told you/);
  assert.match(fast, /fastSummary \?/,
    'the compressed earlier-conversation summary must reach the prompt');
});

// Every prompt that talks to a customer must carry the script rules; before
// this, only the slow path did, so most Amharic traffic never saw them.
test('every reply prompt carries the per-message language block', () => {
  // The block itself lives in conversationContext.mjs so it can be unit tested
  // — see conversationContext.test.mjs for its behaviour.
  assert.match(src, /import \{[^}]*buildLanguageBlock[^}]*\} from '\.\/conversationContext\.mjs'/);
  // Slow path: appended to the volatile block so it stays out of the cached prefix.
  assert.match(src, /volatileBlock \+= buildLanguageBlock\(incomingText, \{/);
  // Fast path: computed once, and used by all three prompt variants.
  assert.match(src, /const fastLanguageBlock = buildLanguageBlock\(msg\.text, \{/);
  const fast = src.slice(src.indexOf('── FAST PATH'), src.indexOf('FAST PATH DONE'));
  assert.equal((fast.match(/\$\{fastLanguageBlock\}/g) || []).length, 3,
    'all three fast-path prompt variants (personal, secretary, bot) need it');
  // Both paths pass the conversation's remembered script, so a bare "218897"
  // inherits the language instead of resetting the thread to English.
  assert.equal((src.match(/lastScript: conversation\?\.metadata\?\.last_customer_script/g) || []).length, 2);
});

// The /start greeting picked its language from business.description — the
// OWNER's text, which the customer has never seen. A shop that described itself
// in Amharic greeted every customer in Amharic, including the ones who opened in
// English, and the thread then stayed in the wrong language.
test('first contact reads the customer, never the business description', () => {
  assert.doesNotMatch(src, /isAmharic\(business\.description/,
    'the welcome language must not be taken from the owner-facing description');
  assert.match(src, /const isAmh = isAmharicish\(msg\.text \|\| ''\)/,
    'the only signal that means anything here is what the customer just typed');
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
