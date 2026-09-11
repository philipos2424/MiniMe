/**
 * Per-message language rules and the "you already said this" block.
 *
 * Both come from one real transcript. The customer wrote English —
 * "tell me what you can do", "why i need to use it" — and got Amharic back
 * every time, because English returned no language rule at all and the rest of
 * the prompt is Amharic-heavy. And every single reply opened with "ሰላም! 👋",
 * mid-conversation, while re-asking a question it had already asked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLanguageBlock, buildContinuityBlock, hasLanguageSignal,
} from '../conversationContext.mjs';

// ───────────────────────────── language ─────────────────────────────

test('an English message gets an explicit English-only instruction', () => {
  // This is the regression: it used to return '' to save tokens, and the
  // surrounding CHAT AMHARIC section plus Amharic style samples won by default.
  const out = buildLanguageBlock('tell me what you can do');
  assert.notEqual(out.trim(), '', 'English must not be silent');
  assert.match(out, /ENGLISH/);
  assert.match(out, /Do NOT switch to Amharic/);
});

test('each script is mirrored back in the script they used', () => {
  assert.match(buildLanguageBlock('ዋጋው ስንት ነው'), /ፊደል/);

  const latin = buildLanguageBlock('nege emetalehu eshi');
  assert.match(latin, /LATIN letters/);
  assert.match(latin, /Do NOT answer in ፊደል/,
    'answering Latin-script Amharic in ፊደል switches a script they deliberately did not use');
});

test('a script-neutral message keeps the language the conversation is in', () => {
  // The OTP case: "218897" carries no language signal, and defaulting it to
  // English mid-thread flips an Amharic conversation for no reason.
  const out = buildLanguageBlock('218897', { lastScript: 'ethiopic' });
  assert.match(out, /ፊደል/);

  assert.match(buildLanguageBlock('ok', { lastScript: 'latin-am' }), /LATIN letters/);
  // With no remembered script there is nothing to inherit — English is the default.
  assert.match(buildLanguageBlock('218897'), /ENGLISH/);
});

test('a real English sentence overrides a remembered Amharic script', () => {
  const out = buildLanguageBlock('do you deliver to Bole tomorrow', { lastScript: 'ethiopic' });
  assert.match(out, /ENGLISH/, 'stickiness is for neutral messages, not a language lock');
});

test('hasLanguageSignal separates real words from codes and emoji', () => {
  for (const neutral of ['218897', 'ok', '👍', '1000', '...', 'hi']) {
    assert.equal(hasLanguageSignal(neutral), false, `${neutral} should carry no signal`);
  }
  for (const signal of ['do you deliver', 'ሰላም', 'nege emetalehu eshi']) {
    assert.equal(hasLanguageSignal(signal), true, `${signal} should carry a signal`);
  }
});

// ──────────────────────────── continuity ────────────────────────────

const inbound = c => ({ direction: 'inbound', content: c });
const outbound = c => ({ direction: 'outbound', content: c });

test('the first message in a conversation has nothing to avoid', () => {
  assert.equal(buildContinuityBlock([]), '');
  assert.equal(buildContinuityBlock([inbound('hi')]), '',
    'nothing has been said yet — there is no greeting to repeat');
});

test('once we have replied, greeting again is forbidden by name', () => {
  const out = buildContinuityBlock([inbound('hi'), outbound('ሰላም! 👋 እንዴት ልርዳህ?')]);
  assert.match(out, /ALREADY greeted/);
  assert.match(out, /ሰላም/, 'naming the actual greeting is what makes this stick');
  assert.match(out, /👋/);
});

test('recent openers are quoted back so the next reply opens differently', () => {
  const out = buildContinuityBlock([
    outbound('ሰላም! 👋 iConnect የተለያዩ ካርዶችን ይሰጣል'),
    inbound('why i need to use it'),
    outbound('ሰላም! 👋 iConnect በቀላሉ ይረዳል'),
  ]);
  assert.match(out, /opened with/);
  assert.match(out, /Open differently/);
});

test('questions already asked are listed, in either script', () => {
  const out = buildContinuityBlock([
    outbound('እርስዎ ምን ዓይነት ነገር ለማግኘት ትፈልጋሉ?'),
    inbound('hmm'),
    outbound('which one caught your eye?'),
  ]);
  assert.match(out, /already asked/i);
  assert.match(out, /which one caught your eye\?/);
  assert.match(out, /ትፈልጋሉ\?/);
  assert.match(out, /Do not ask any of these again/);
});

test('two identical replies in a row are called out explicitly', () => {
  const repeated = 'ሰላም! 🙌 እባክህ ተገልጸው ይላኩ።';
  const out = buildContinuityBlock([outbound(repeated), inbound('?'), outbound(repeated)]);
  assert.match(out, /nearly the same reply twice/);
  assert.match(out, /third time/);
});

test('different replies are not flagged as a loop', () => {
  const out = buildContinuityBlock([
    outbound('yep we have it, 4000 birr'),
    inbound('ok'),
    outbound('want me to send the link?'),
  ]);
  assert.doesNotMatch(out, /same reply twice/);
});

test('messages with no content never throw', () => {
  const out = buildContinuityBlock([
    { direction: 'outbound', content: null },
    { direction: 'outbound' },
    outbound('hey'),
  ]);
  assert.equal(typeof out, 'string');
});
