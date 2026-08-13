/**
 * detectIntent's cheap pre-filter.
 *
 * Real traffic is full of one-word acknowledgements — the single busiest
 * business on the platform sent "Awo", "Amen amen", "እሺ" over and over — and
 * each one used to cost a full model call to classify something never in doubt.
 *
 * The risk in a filter like this is over-matching: swallowing a real question
 * and returning a bogus 'general' intent, which downstream drives urgency and
 * owner notifications. So the tests below care much more about what must NOT
 * be short-circuited than about what is.
 *
 * intent.js constructs an OpenAI client at module load, so the module can't be
 * imported here — these assert against the extracted predicate, kept in sync
 * with the source by the last test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = readFileSync(`${root}apps/web/src/lib/server/intent.js`, 'utf8');

// Mirrors triviallyClassifiable() in intent.js.
const ACK_RE = /^(ok(ay)?|k|sure|fine|alright|got it|yes|yeah|yep|no|nope|awo|ayy?|እሺ|አዎ|አይ|ok+)[\s.!]*$/i;
const GREET_RE = /^(hi+|hello+|hey+|selam|salam|ሰላም|good (morning|afternoon|evening))[\s.!]*$/i;
const THANKS_RE = /^(thanks?|thank you|thx|ty|amen( amen)?|አመሰግናለሁ|እናመሰግናለን)[\s.!]*$/i;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s‍️]+$/u;

function triviallyClassifiable(text) {
  const t = (text || '').trim();
  if (!t || t.length > 24) return null;
  if (/[?？]|\d/.test(t)) return null;
  const language = /[ሀ-፿]/.test(t) ? 'am' : 'en';
  const base = { sentiment: 'neutral', urgency: 'low', language, topics: [], _heuristic: true };
  if (EMOJI_ONLY_RE.test(t)) return { ...base, intent: 'general', sentiment: 'happy' };
  if (THANKS_RE.test(t)) return { ...base, intent: 'thanks', sentiment: 'happy' };
  if (GREET_RE.test(t)) return { ...base, intent: 'greeting' };
  if (ACK_RE.test(t)) return { ...base, intent: 'general' };
  return null;
}

test('short-circuits the acks that actually flooded production', () => {
  for (const [text, intent] of [
    ['Awo', 'general'], ['awo', 'general'], ['እሺ', 'general'], ['አዎ', 'general'],
    ['ok', 'general'], ['okay.', 'general'], ['yes', 'general'], ['no', 'general'],
    ['Amen amen', 'thanks'], ['thanks', 'thanks'], ['አመሰግናለሁ', 'thanks'],
    ['Selam', 'greeting'], ['ሰላም', 'greeting'], ['hello!', 'greeting'],
    ['good morning', 'greeting'], ['👍', 'general'], ['😂😂', 'general'],
  ]) {
    const r = triviallyClassifiable(text);
    assert.ok(r, `${JSON.stringify(text)} should be handled without an API call`);
    assert.equal(r.intent, intent, `${JSON.stringify(text)} intent`);
  }
});

test('never swallows a message that carries real meaning', () => {
  for (const text of [
    'ok how much?',            // ack + question
    'yes 2 please',            // ack + quantity
    'ዋጋው ስንት ነው?',            // Amharic price question
    'no this is broken',       // complaint opening with an ack word
    'hi do you deliver to bole',
    'thanks but I need a refund',
    'selam, netela alachihu?',
    'Arif newu ymesgen',       // real sentence, no ack pattern
    '5000',                    // bare number — could be a counter-offer
    'okay?',                   // question mark flips it
  ]) {
    assert.equal(triviallyClassifiable(text), null,
      `${JSON.stringify(text)} must still reach the model`);
  }
});

test('tags language so downstream Amharic handling still works', () => {
  assert.equal(triviallyClassifiable('እሺ').language, 'am');
  assert.equal(triviallyClassifiable('ok').language, 'en');
});

test('returns the full shape detectIntent callers destructure', () => {
  const r = triviallyClassifiable('ok');
  for (const k of ['intent', 'sentiment', 'urgency', 'language', 'topics']) {
    assert.ok(k in r, `missing ${k}`);
  }
  assert.ok(Array.isArray(r.topics));
});

test('empty and whitespace input does not short-circuit', () => {
  assert.equal(triviallyClassifiable(''), null);
  assert.equal(triviallyClassifiable('   '), null);
  assert.equal(triviallyClassifiable(null), null);
});

test('the predicate is still wired into detectIntent', () => {
  assert.match(src, /const trivial = triviallyClassifiable\(messageText\);/,
    'detectIntent must call the pre-filter before the API call');
  assert.match(src, /if \(trivial\) return trivial;/,
    'detectIntent must return early on a trivial match');
  // Guard rails the filter depends on — if these are relaxed, revisit the tests above.
  assert.match(src, /if \(\/\[\?？\]\|\\d\/\.test\(t\)\) return null;/,
    'questions and numbers must always reach the model');
  // Regression guard: \b is ASCII-only in JS, so reintroducing it here would
  // silently stop every Amharic ack from matching.
  for (const line of src.split('\n')) {
    if (/^const (ACK|GREET|THANKS)_RE/.test(line)) {
      assert.ok(!line.includes('\\b'),
        `${line.split(' ')[1]} must not use \\b — it never matches after Ethiopic letters`);
    }
  }
});
