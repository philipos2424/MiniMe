/**
 * The parse is what makes a swap findable, and it runs on BOTH halves of the
 * post: the item and the wants. The reverse index in swapSearch is only as
 * good as the keywords extracted from "winter jacket or a good watch".
 *
 * The LLM is injected rather than imported so these tests never hit the
 * network — a swap post must not depend on OpenAI being reachable to be
 * testable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSwapText, expandKeywords, postLang } from '../swap/swapParse.mjs';

/** Fake `loggedCompletion` returning whatever JSON the test names. */
function fakeLLM(payload, onCall) {
  return async (args) => {
    onCall?.(args);
    return { choices: [{ message: { content: JSON.stringify(payload) } }] };
  };
}

test('extracts category and keywords from an item description', async () => {
  const r = await parseSwapText('Redmi Note 10, 128gb, small crack', {
    complete: fakeLLM({ category: 'electronics_phones', keywords: ['phone', 'redmi'], banned: null }),
  });
  assert.equal(r.category, 'electronics_phones');
  assert.ok(r.keywords.includes('phone'));
  assert.equal(r.banned, null);
});

test('a banned item is refused with a reason and no keywords survive', async () => {
  const r = await parseSwapText('AK47 magazine', {
    complete: fakeLLM({ category: null, keywords: ['gun'], banned: 'weapons' }),
  });
  assert.equal(r.banned, 'weapons');
  assert.deepEqual(r.keywords, []);
});

test('an unparseable LLM reply degrades to empty, never throws', async () => {
  const complete = async () => ({ choices: [{ message: { content: 'not json' } }] });
  const r = await parseSwapText('anything', { complete });
  assert.deepEqual(r, { category: null, keywords: [], banned: null });
});

test('a thrown LLM call degrades to empty, never throws', async () => {
  const complete = async () => { throw new Error('network down'); };
  const r = await parseSwapText('anything', { complete });
  assert.deepEqual(r, { category: null, keywords: [], banned: null });
});

test('keywords are capped so one post cannot dominate the index', async () => {
  const many = Array.from({ length: 30 }, (_, i) => `k${i}`);
  const r = await parseSwapText('x', { complete: fakeLLM({ category: null, keywords: many, banned: null }) });
  assert.ok(r.keywords.length <= 8, `got ${r.keywords.length}`);
});

test('expandKeywords bridges scripts so Amharic and English find each other', () => {
  const out = expandKeywords(['jacket']);
  assert.ok(out.includes('jacket'));
  assert.ok(out.length >= 1);
  assert.deepEqual(out, [...new Set(out)], 'no duplicates');
  assert.ok(out.every(k => k === k.toLowerCase()));
});

test('postLang mirrors the script the lister actually typed in', () => {
  assert.equal(postLang('ጃኬት እፈልጋለሁ'), 'am');
  assert.equal(postLang('winter jacket'), 'en');
});
