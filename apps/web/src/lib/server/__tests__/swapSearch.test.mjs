/**
 * Two rules in here are commercial, not cosmetic: swaps are capped at three
 * cards and never rank above the businesses that pay for the platform. A
 * refactor that "improves" swap visibility by relaxing either one is a
 * regression against the business model, so both are asserted directly.
 *
 * The reverse block (people who WANT what you searched) is the other load
 * bearing piece — it is what makes a thin pool feel liquid, and it comes
 * free from the same query.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCommercialQuery, selectSwapCards, formatSwapBlocks, swapEmptyLine } from '../swap/swapSearch.mjs';
import { MAX_SWAP_CARDS } from '../swap/constants.mjs';

const item = (over = {}) => ({
  id: 'i1', title: 'Redmi Note 10', wants_text: 'winter jacket', condition: 'good',
  area: 'bole', photo_file_ids: ['f1'], created_at: new Date().toISOString(), ...over,
});

test('commercial queries suppress swaps entirely', () => {
  for (const q of ['phone delivery', 'wholesale jackets', 'shop for shoes', 'phone supplier']) {
    assert.equal(isCommercialQuery(q), true, q);
  }
  for (const q of ['phone', 'winter jacket', 'ጃኬት']) {
    assert.equal(isCommercialQuery(q), false, q);
  }
});

test('the two blocks together never exceed the card cap', () => {
  const haves = Array.from({ length: 5 }, (_, i) => item({ id: `h${i}` }));
  const wants = Array.from({ length: 5 }, (_, i) => item({ id: `w${i}` }));
  const sel = selectSwapCards({ haves, wants, searcherArea: null });
  assert.equal(sel.haves.length + sel.wants.length, MAX_SWAP_CARDS);
});

test('haves are filled before wants — the thing you searched for comes first', () => {
  const haves = Array.from({ length: 5 }, (_, i) => item({ id: `h${i}` }));
  const wants = Array.from({ length: 5 }, (_, i) => item({ id: `w${i}` }));
  const sel = selectSwapCards({ haves, wants, searcherArea: null });
  assert.ok(sel.haves.length >= sel.wants.length);
});

test('a want block still shows when there are no haves at all', () => {
  const wants = [item({ id: 'w1' })];
  const sel = selectSwapCards({ haves: [], wants, searcherArea: null });
  assert.equal(sel.haves.length, 0);
  assert.equal(sel.wants.length, 1);
});

test('same-area posts sort ahead of far ones', () => {
  const haves = [item({ id: 'far', area: 'ayat' }), item({ id: 'near', area: 'bole' })];
  const sel = selectSwapCards({ haves, wants: [], searcherArea: 'bole' });
  assert.equal(sel.haves[0].id, 'near');
});

test('newer posts sort ahead when area does not decide it', () => {
  const old = item({ id: 'old', created_at: new Date(Date.now() - 10 * 86400000).toISOString() });
  const fresh = item({ id: 'fresh', created_at: new Date().toISOString() });
  const sel = selectSwapCards({ haves: [old, fresh], wants: [], searcherArea: null });
  assert.equal(sel.haves[0].id, 'fresh');
});

test('every card leads with what the owner wants — in barter that is the price', () => {
  const out = formatSwapBlocks({ haves: [item()], wants: [], query: 'phone', lang: 'en' });
  const linesAfterTitle = out.text.split('\n').filter(Boolean);
  const titleIdx = linesAfterTitle.findIndex(l => l.includes('Redmi Note 10'));
  assert.ok(linesAfterTitle[titleIdx + 1].includes('Wants:'), out.text);
});

test('each card carries an interest button addressed to its own item', () => {
  const out = formatSwapBlocks({ haves: [item({ id: 'abc' })], wants: [], query: 'phone', lang: 'en' });
  assert.ok(out.keyboard.flat().some(b => b.callback_data === 'sw:want:abc'));
});

test('the reverse block is labelled as people who WANT the query', () => {
  const out = formatSwapBlocks({ haves: [], wants: [item({ id: 'w1' })], query: 'phone', lang: 'en' });
  assert.match(out.text, /who WANT/i);
  assert.ok(out.text.includes('phone'));
});

test('nothing to show returns null so the caller appends nothing', () => {
  assert.equal(formatSwapBlocks({ haves: [], wants: [], query: 'phone', lang: 'en' }), null);
});

test('the empty state recruits supply for the exact thing searched', () => {
  const line = swapEmptyLine('winter jacket', 'en');
  assert.match(line, /winter jacket/);
  assert.match(line, /photo/i);
});
