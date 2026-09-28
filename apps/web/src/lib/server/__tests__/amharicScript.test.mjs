/**
 * Latin-script Amharic detection.
 *
 * The complaint that produced this module: "the bot didn't understand Amharic
 * English text eg. Nege emetalehu, now a lot of Ethiopia texting like this."
 *
 * The asymmetry that matters: a message we fail to detect just behaves the way
 * it did before (English reply to Amharic — bad but survivable), while a false
 * positive answers an English speaker in Amharic. So the negative cases below
 * are the ones with teeth, and several of them are English sentences containing
 * words that ARE Amharic ("new", "man", "yet", "injera").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeToken, scoreLatinAmharic, isLatinAmharic, detectScript,
  hasEthiopic, isAmharicish, prefersLatinScript, languageTag,
} from '../amharicScript.mjs';

test('normalizer folds the spellings one word actually arrives in', () => {
  // Nobody agrees how to romanize these — they must all land on one key.
  for (const group of [
    ['emetalehu', 'imetalehu', 'emethalehu', 'emetaleu'],
    ['eshi', 'ishi', 'eshee', 'ishee'],
    ['betam', 'bettam', 'bettamm'],
    ['dehna', 'dena'],
    ['selam', 'sellam'],
  ]) {
    const keys = new Set(group.map(normalizeToken));
    assert.equal(keys.size, 1,
      `${group.join(' / ')} should normalize together, got ${[...keys].join(' / ')}`);
  }
});

test('normalizer is total — never throws, never returns junk', () => {
  for (const input of ['', '   ', null, undefined, '!!!', '123', 'ሰላም', 'a']) {
    assert.equal(typeof normalizeToken(input), 'string');
  }
});

test('detects the messages Ethiopians actually send', () => {
  for (const text of [
    'Nege emetalehu',              // the reported case — "I'll come tomorrow"
    'nege emetalehu',
    'Nege imetalehu',
    'eshi nege',
    'selam dehna neh',
    'sint new waga',
    'selam netela alachihu',
    'zare mata emetalehu',
    'betam konjo new',
    'lemin yelem',
    'ahun lakelign',
    'waga sint new',
    'tinantina metalehu',
    'amesegnalehu gashe',
  ]) {
    assert.ok(isLatinAmharic(text),
      `${JSON.stringify(text)} must be recognized as Latin-script Amharic`);
    assert.equal(languageTag(text), 'am', `${JSON.stringify(text)} language tag`);
  }
});

test('does NOT fire on English — including English carrying Amharic words', () => {
  for (const text of [
    'do you have beer',            // 'birr' and 'beer' fold together
    'is this a new item',          // 'new' is ነው but also English
    'who is the man in the photo', // 'man' is ማን
    'not yet, i will let you know', // 'yet' is የት
    'do you have injera',          // one loanword inside an English sentence
    'can i order 2 of these',
    'hi do you deliver to bole',
    'thanks but I need a refund',
    'what time do you close today',
    'ok how much for 3',
    'the new price list please',
    'sew the dress for me',        // 'sew' is ሰው
  ]) {
    assert.equal(isLatinAmharic(text), false,
      `${JSON.stringify(text)} must NOT be treated as Amharic`);
    assert.equal(detectScript(text), 'en', `${JSON.stringify(text)} script`);
  }
});

test('classifies each script the reply logic branches on', () => {
  assert.equal(detectScript('ሰላም ዋጋው ስንት ነው'), 'ethiopic');
  assert.equal(detectScript('nege emetalehu'), 'latin-am');
  assert.equal(detectScript('can i order 2'), 'en');
  assert.equal(detectScript(''), 'en');
  assert.equal(detectScript(null), 'en');
  // Ethiopic + Latin-Amharic is one Amharic message in two scripts, not mixing.
  assert.equal(detectScript('ሰላም nege emetalehu'), 'ethiopic');
  // Ethiopic + real English is genuine code-switching.
  assert.equal(detectScript('ሰላም do you deliver to Bole today'), 'mixed');
});

test('mixed English/Amharic in Latin letters stays mixed, not pure Amharic', () => {
  // Enough Amharic to detect, but the customer is code-switching — the reply
  // should code-switch too rather than flip fully into Amharic.
  const s = detectScript('selam, is the netela available for delivery tomorrow');
  assert.equal(s, 'mixed');
  assert.equal(languageTag('selam, is the netela available for delivery tomorrow'), 'mixed');
});

test('prefersLatinScript decides whether the reply may use ፊደል', () => {
  // The point of the whole feature: Latin in → Latin out.
  assert.equal(prefersLatinScript('nege emetalehu'), true);
  // They chose ፊደል — reply in ፊደል.
  assert.equal(prefersLatinScript('ነገ እመጣለሁ'), false);
  assert.equal(prefersLatinScript('can i order 2'), false);
  // Mixed with no Ethiopic anywhere still means they're typing in Latin.
  assert.equal(prefersLatinScript('selam, is the netela available for delivery tomorrow'), true);
});

test('isAmharicish covers every non-English case', () => {
  assert.equal(isAmharicish('ነገ እመጣለሁ'), true);
  assert.equal(isAmharicish('nege emetalehu'), true);
  assert.equal(isAmharicish('ሰላም do you deliver'), true);
  assert.equal(isAmharicish('can i order 2'), false);
});

test('hasEthiopic keeps the old narrow test available', () => {
  assert.equal(hasEthiopic('ሰላም'), true);
  assert.equal(hasEthiopic('selam'), false);
  assert.equal(hasEthiopic(null), false);
});

test('scoring exposes what matched so misfires are debuggable', () => {
  const r = scoreLatinAmharic('Nege emetalehu');
  assert.equal(r.tokens, 2);
  assert.equal(r.strong, 2);
  assert.deepEqual(r.matched, ['Nege', 'emetalehu']);
  assert.ok(r.ratio > 0.9);
});

test('weak tokens can never trigger detection on their own', () => {
  // Every token here is in the WEAK list and nothing else.
  for (const text of ['new man yet', 'ale sew lay gena', 'min man yet new']) {
    assert.equal(scoreLatinAmharic(text).strong, 0, `${text} should have no strong hits`);
    assert.equal(isLatinAmharic(text), false, `${text} must not fire on weak tokens alone`);
  }
});

test('a single strong word must dominate a short message, not just appear', () => {
  // One Amharic word buried in a longer English sentence is an English message.
  assert.equal(isLatinAmharic('please send the injera order to my office address'), false);
  // But a two-word Amharic message is unambiguous.
  assert.equal(isLatinAmharic('eshi tiru'), true);
});
