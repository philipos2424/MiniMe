import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordMatch, keywordScore, semanticScore, productScore, qualityScore,
  scoreCandidate, rankCandidates, isRelevant,
} from '../searchRanker.mjs';

test('wordMatch respects word boundaries — "car" does not match "carpet"', () => {
  assert.equal(wordMatch('persian carpet cleaning', 'car'), false);
  assert.equal(wordMatch('scarf boutique', 'car'), false);
  assert.equal(wordMatch('car rental addis', 'car'), true);
  assert.equal(wordMatch('we sell cars', 'car'), true); // plural
});

test('wordMatch handles Amharic script', () => {
  assert.equal(wordMatch('የመኪና ኪራይ', 'መኪና'), true);
  assert.equal(wordMatch('የመኪና ኪራይ', 'ስልክ'), false);
});

test('keywordScore weights name hits above description hits', () => {
  const nameHit = keywordScore({ name: 'Laptop Repair Hub' }, ['laptop']);
  const descHit = keywordScore({ name: 'Tech Hub', description: 'we fix any laptop' }, ['laptop']);
  assert.ok(nameHit.score > descHit.score);
  assert.ok(nameHit.fields.includes('name'));
});

test('keywordScore returns 0 with no keywords', () => {
  assert.equal(keywordScore({ name: 'x' }, []).score, 0);
});

test('semanticScore normalizes into 0..1', () => {
  assert.equal(semanticScore(null), 0);
  assert.equal(semanticScore(0.15), 0);
  assert.equal(semanticScore(0.75), 1);
  assert.ok(semanticScore(0.45) > 0 && semanticScore(0.45) < 1);
});

test('productScore rewards in-budget product over out-of-budget', () => {
  assert.equal(productScore({}), 0);
  assert.equal(productScore({ _matched_product: { _inBudget: false } }), 0.6);
  assert.equal(productScore({ _matched_product: { name: 'x' } }), 1.0);
});

test('qualityScore stays within 0..1 and rewards verified', () => {
  const q = qualityScore({ verified: true, average_rating: 5, total_reviews: 10, search_count: 100 }, 100);
  assert.ok(q > 0 && q <= 1);
  assert.ok(qualityScore({ verified: true }, 0) > qualityScore({ verified: false }, 0));
});

test('a perfect keyword+product match outranks a high-quality weak match', () => {
  const perfect = { id: 'a', name: 'Laptop Repair', _matched_product: { name: 'laptop screen' } };
  const shiny = { id: 'b', name: 'General Store', verified: true, average_rating: 5, total_reviews: 200, search_count: 999 };
  const ranked = rankCandidates([shiny, perfect], { keywords: ['laptop'] });
  assert.equal(ranked[0].id, 'a');
});

test('quality only breaks ties, cannot dominate relevance', () => {
  const s = scoreCandidate(
    { verified: true, average_rating: 5, total_reviews: 500, search_count: 500 },
    { keywords: ['laptop'], maxSearchCount: 500 },
  );
  // No keyword/semantic/product signal → score is only the small quality weight.
  assert.ok(s.score <= 0.08 + 1e-9);
});

test('category discipline drops cross-category shops but keeps uncategorized', () => {
  const rows = [
    { id: 'a', name: 'Bole Salon', category: 'beauty_wellness' },
    { id: 'b', name: 'Laptop Fix', category: 'it_tech' },
    { id: 'c', name: 'New Shop', category: null },
  ];
  const ranked = rankCandidates(rows, { keywords: [], category: 'it_tech' });
  const ids = ranked.map(r => r.id);
  assert.ok(ids.includes('b'));
  assert.ok(ids.includes('c'));
  assert.ok(!ids.includes('a'));
});

test('dedupe merges annotations from multiple retrievers', () => {
  const fromKeyword = { id: 'a', name: 'Laptop Repair', _matched_product: { name: 'ssd' } };
  const fromSemantic = { id: 'a', name: 'Laptop Repair', _similarity: 0.6 };
  const ranked = rankCandidates([fromKeyword, fromSemantic], { keywords: ['laptop'] });
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0]._matched_product);
  assert.equal(ranked[0]._similarity, 0.6);
});

test('isRelevant is false for quality-only candidates', () => {
  const ranked = rankCandidates(
    [{ id: 'a', name: 'General Store', verified: true, average_rating: 5, total_reviews: 10 }],
    { keywords: ['laptop'] },
  );
  assert.equal(isRelevant(ranked[0]), false);
});
