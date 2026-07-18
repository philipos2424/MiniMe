import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscriptionPrompt, buildTranslationPrompt, mapLanguage, extractResponseText } from '../addisAIPrompts.mjs';

test('buildTranscriptionPrompt instructs verbatim-only output', () => {
  const p = buildTranscriptionPrompt();
  assert.ok(/transcribe/i.test(p));
  assert.ok(/do not answer/i.test(p));
});

test('buildTranslationPrompt names both languages and embeds the text', () => {
  const p = buildTranslationPrompt('hello world', 'en', 'am');
  assert.ok(p.includes('English'));
  assert.ok(p.includes('Amharic'));
  assert.ok(p.includes('hello world'));
});

test('buildTranslationPrompt adds the Amharic tone hint only when translating INTO Amharic', () => {
  const toAm = buildTranslationPrompt('x', 'en', 'am');
  const toEn = buildTranslationPrompt('x', 'am', 'en');
  assert.ok(toAm.includes('shopkeeper'));
  assert.ok(!toEn.includes('shopkeeper'));
});

test('mapLanguage translates legacy Hasab codes', () => {
  assert.equal(mapLanguage('amh'), 'am');
  assert.equal(mapLanguage('eng'), 'en');
  assert.equal(mapLanguage('auto'), undefined);
  assert.equal(mapLanguage('unknown'), undefined);
});

test('extractResponseText tries multiple plausible field names', () => {
  assert.equal(extractResponseText({ responseText: ' hi ' }), 'hi');
  assert.equal(extractResponseText({ response_text: 'hi2' }), 'hi2');
  assert.equal(extractResponseText({ text: 'hi3' }), 'hi3');
  assert.equal(extractResponseText({ message: 'hi4' }), 'hi4');
  assert.equal(extractResponseText({ data: { responseText: 'hi5' } }), 'hi5');
});

test('extractResponseText returns empty string for unrecognized shapes', () => {
  assert.equal(extractResponseText({}), '');
  assert.equal(extractResponseText(null), '');
  assert.equal(extractResponseText({ foo: 'bar' }), '');
  assert.equal(extractResponseText({ responseText: '   ' }), '');
});
