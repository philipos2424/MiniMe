/**
 * The complaint that produced this work: "minime is replying to customers
 * saying im having trouble understanding, ill let the owner know" — and
 * "even if the answer is obvious it is not responding correctly".
 *
 * Two things had to be true for that to happen, and both are asserted here:
 *
 *   1. The fast path (~70% of traffic) only looked in the knowledge base when
 *      the message matched an ENGLISH keyword list, so Amharic / mixed / short
 *      questions got no facts at all — and it sent whatever the model returned
 *      without checking whether the draft was a punt.
 *   2. When generation failed outright, the catch around draftReply went
 *      straight to a customer-facing apology instead of answering from data the
 *      business already had (a catalog price, an owner-taught FAQ).
 *
 * replyEngine.js cannot be imported here (extensionless specifiers only the Next
 * bundler resolves — same reason replyEngine.test.mjs asserts on source text),
 * so the wiring is asserted against the source and the matching rules are tested
 * directly against the extracted pure module.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pickLocalFallback } from '../localFallbackLogic.mjs';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = readFileSync(`${root}apps/web/src/lib/server/replyEngine.js`, 'utf8');

// ── The matching rules ──────────────────────────────────────────────────────

test('an owner-taught FAQ is reused verbatim when generation is down', () => {
  const out = pickLocalFallback({
    text: 'what are your opening hours?',
    faqs: [{ question: 'what are your opening hours?', answer: 'Mon-Sat, 8:00 to 18:00.' }],
  });
  assert.equal(out, 'Mon-Sat, 8:00 to 18:00.');
});

test('a message that merely contains the stored question still matches', () => {
  const out = pickLocalFallback({
    text: 'hi, how much is delivery?',
    faqs: [{ question: 'how much is delivery?', answer: 'Delivery is 150 ETB inside Addis.' }],
  });
  assert.equal(out, 'Delivery is 150 ETB inside Addis.');
});

// The whole point of making retrieval language-agnostic: an Amharic question
// must be answerable from an Amharic FAQ without any English keyword present.
test('an Amharic FAQ matches an Amharic message with no English in it', () => {
  const question = 'የሚሰሩበት ሰዓት ስንት ነው?';
  const answer = 'ከጠዋቱ 8 እስከ ማታ 6 እንሰራለን።';
  const out = pickLocalFallback({ text: question, faqs: [{ question, answer }] });
  assert.equal(out, answer);
});

test('behaviour rules are not mistaken for FAQs', () => {
  // owner_instructions also carries {rule} entries — they have no answer to send.
  const out = pickLocalFallback({
    text: 'what are your opening hours?',
    faqs: [{ rule: 'always be polite' }, { question: 'unanswered question' }],
  });
  assert.equal(out, null);
});

test('an unrelated message matches nothing and returns null', () => {
  const out = pickLocalFallback({
    text: 'hello there',
    faqs: [{ question: 'what are your opening hours?', answer: 'Mon-Sat.' }],
    products: [{ name: 'Blue Tote', price: 850, currency: 'ETB' }],
    paymentLines: ['Telebirr 0911223344'],
  });
  assert.equal(out, null);
});

test('a catalog name match answers with the stored price, not a guess', () => {
  const out = pickLocalFallback({
    text: 'how much is the blue tote?',
    products: [{ name: 'Blue Tote', price: 850, currency: 'ETB' }],
  });
  assert.equal(out, 'Blue Tote — 850 ETB');
});

test('the Amharic product name matches when it appears as stored', () => {
  // Matching is on the stored name rather than on stems: Amharic inflects with
  // affixes ("ሰማያዊው" vs "ሰማያዊ"), and loosening this to single words would risk
  // quoting the wrong product's price. An inflected form falls through to the
  // holding reply, and the FAQ path is the language-agnostic one.
  const out = pickLocalFallback({
    text: 'ሰማያዊ ቦርሳ ዋጋ ስንት ነው?',
    products: [{ name: 'Blue Tote', name_am: 'ሰማያዊ ቦርሳ', price: 850, currency: 'ETB' }],
  });
  assert.equal(out, 'Blue Tote — 850 ETB');
});

test('a product with no price is skipped rather than quoted as undefined', () => {
  const out = pickLocalFallback({
    text: 'how much is the blue tote?',
    products: [{ name: 'Blue Tote' }],
  });
  assert.equal(out, null);
});

test('payment details are shared only when payment is what was asked', () => {
  const paymentLines = ['Telebirr 0911223344'];
  assert.equal(
    pickLocalFallback({ text: 'what is your telebirr number?', paymentLines }),
    'Telebirr 0911223344',
  );
  assert.equal(pickLocalFallback({ text: 'do you deliver on sundays', paymentLines }), null);
});

test('an over-long paste is not answered from a fuzzy match', () => {
  const out = pickLocalFallback({
    text: 'x'.repeat(401),
    faqs: [{ question: `x`.repeat(401), answer: 'should not be used' }],
  });
  assert.equal(out, null);
});

// ── The wiring in replyEngine.js ────────────────────────────────────────────

test('the fast path no longer gates knowledge retrieval on English keywords', () => {
  assert.doesNotMatch(src, /KNOWLEDGE_NEEDED_RE/,
    'the English-only keyword gate must stay deleted — it is why Amharic and short questions retrieved nothing');
  assert.match(src, /const needsKnowledge = !!msg\.text && !isAcknowledgementOnly\(msg\.text\);/,
    'the fast path must retrieve for any real message, in any language');
});

test('the fast path refuses to send a punt it cannot ground', () => {
  assert.match(src, /const fastUngroundedPunt = !!fastReply && replyLooksUnsure\(fastReply\) && fastChunks\.length === 0;/,
    'an ungrounded "let me confirm with the owner" draft must not be sent straight to the customer');
  assert.match(src, /if \(!fastUngroundedPunt && fastReply && fastReply\.length > 0\) \{/,
    'the send must be guarded by the grounding check');
});

test('the crash path answers from local data before apologising', () => {
  assert.match(src, /let localAnswer = await buildLocalFallbackAnswer\(business, msg\.text\)/,
    'the catch around draftReply must try a local answer first');
  assert.match(src, /text: localAnswer \|\| \(\(\) => \{/,
    'the local answer must take precedence over the holding reply');
  assert.match(src, /import \{ pickLocalFallback \} from '\.\/localFallbackLogic\.mjs';/,
    'the matching rules must live in the tested module');
});

test('a failed first attempt is retried once with a genuinely smaller prompt', () => {
  assert.match(src, /const \{ isSecretary = false, preview = false, slim = false \} = options;/,
    'draftReply must accept a slim mode');
  assert.match(src, /slim: true,/,
    'the catch must retry draftReply in slim mode');
  assert.match(src, /if \(retry\?\.draft && !retry\.knowledgeGap\) \{/,
    'a punt is not an answer — the retry result must clear the grounding check too');

  // The retry only helps if it actually shrinks the request: the whole reason
  // the first attempt died is prompt size against a provider's TPM budget.
  assert.match(src, /const historyDepth = slim \? 12 :/, 'slim must cut the history depth');
  assert.match(src, /const RAW_TURNS = slim \? 8 :/, 'slim must cut the verbatim window');
  assert.match(src, /slim \? \{ count: 2, threshold: 0\.2 \}/, 'slim must cut retrieved chunks');
  assert.match(src, /maxTotal: slim \? 4000 :/, 'slim must cut the history token cap');

  // Spending another model call on compression is the last thing to do when the
  // model is what failed.
  assert.match(src, /rawWindow = recent\.slice\(-RAW_TURNS\);/,
    'the slim pass must not call the rolling-summary model');
});

test('the customer is never told the business is "having trouble"', () => {
  // The shipped literal was: "Sorry, I'm having trouble right now — I'll make
  // sure the owner sees your message." Assert on that exact shape; comments may
  // still quote the wording when explaining why it is gone.
  assert.doesNotMatch(src, /Sorry, I'?m having trouble/,
    'this exact wording was the customer-facing symptom being reported');
  assert.match(src, /Bear with me a sec — getting the right answer for you/,
    'the holding reply must not read as the business failing to understand');
});
