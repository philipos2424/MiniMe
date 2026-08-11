import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordMatch, keywordScore, semanticScore, productScore, qualityScore, planScore,
  scoreCandidate, rankCandidates, isRelevant, RANK_WEIGHTS, singularize,
} from '../searchRanker.mjs';

// A Pro shop and a Free shop, identical in every other respect.
const PRO  = { plan_tier: 'pro', subscription_status: 'active' };
const FREE = { plan_tier: 'free', subscription_status: 'expired' };

test('wordMatch respects word boundaries — "car" does not match "carpet"', () => {
  assert.equal(wordMatch('persian carpet cleaning', 'car'), false);
  assert.equal(wordMatch('scarf boutique', 'car'), false);
  assert.equal(wordMatch('car rental addis', 'car'), true);
  assert.equal(wordMatch('we sell cars', 'car'), true); // plural
});

// ── Regression: "rivan flowers" search missed a real product literally named
// "rivan flower small size" — the query keyword ("flowers", plural) was never
// a substring of the product/business text ("flower", singular), and
// substring matching only ever finds the shorter root inside the longer
// inflected form, never the reverse.
test('wordMatch matches a plural keyword against singular text', () => {
  assert.equal(wordMatch('rivan flower small size', 'flowers'), true);
  assert.equal(wordMatch('A shop specializing in custom flower arrangements', 'flowers'), true);
});

test('singularize reduces common plurals to their root, leaves non-plurals alone', () => {
  assert.equal(singularize('flowers'), 'flower');
  assert.equal(singularize('boxes'), 'box');
  assert.equal(singularize('categories'), 'category');
  assert.equal(singularize('glass'), 'glass');
  assert.equal(singularize('laptop'), 'laptop');
});

test('wordMatch handles Amharic script', () => {
  assert.equal(wordMatch('የመኪና ኪራይ', 'መኪና'), true);
  assert.equal(wordMatch('የመኪና ኪራይ', 'ስልክ'), false);
});

// ── Regression: an English "cars" search never found Amharic-only listings —
// "car" and "መኪና" share no characters, so a plain substring/word-boundary
// check across scripts can never match. wordMatch now falls back to the
// termTranslations dictionary when the direct match fails.
test('wordMatch bridges English and Amharic via known translations', () => {
  assert.equal(wordMatch('የመኪና ሽያጭ', 'car'), true);       // EN query, AM-only text
  assert.equal(wordMatch('used cars for sale', 'መኪና'), true); // AM query, EN-only text
  assert.equal(wordMatch('ስልክ እና ኮምፒውተር', 'phone'), true);
  // Translation must not turn into a free-for-all match — unrelated terms
  // still don't match across languages.
  assert.equal(wordMatch('የቡና ሱቅ', 'car'), false);          // "coffee shop" in Amharic
  assert.equal(wordMatch('laptop repair shop', 'መኪና'), false);
});

// ── Regression: retrieveCandidates' Pool C fetches products via a broad SQL
// substring OR, then re-validates each hit with wordMatch before crediting a
// match (searchBot.js). Pin the exact word-boundary behavior that guard
// depends on — a "car" query must not credit incidental substring hits.
test('wordMatch rejects the substrings that used to falsely credit product matches', () => {
  assert.equal(wordMatch('Cargo Bag - Large', 'car'), false);
  assert.equal(wordMatch('USB Card Reader', 'car'), false);
  assert.equal(wordMatch('Toyota Corolla - Used Car', 'car'), true);
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

test('category discipline demotes cross-category shops but keeps uncategorized', () => {
  const rows = [
    { id: 'a', name: 'Bole Salon', category: 'beauty_wellness' },
    { id: 'b', name: 'Laptop Fix', category: 'it_tech' },
    { id: 'c', name: 'New Shop', category: null },
  ];
  const ranked = rankCandidates(rows, { keywords: [], category: 'it_tech' });
  const ids = ranked.map(r => r.id);
  // Nothing is dropped any more — the off-category shop is flagged and demoted.
  assert.deepEqual(new Set(ids), new Set(['a', 'b', 'c']));
  assert.equal(ranked.find(r => r.id === 'a')._categoryMismatch, true);
  assert.equal(ranked.find(r => r.id === 'b')._categoryMismatch, false);
  assert.equal(ranked.find(r => r.id === 'c')._categoryMismatch, false);
});

test('an off-category shop ranks below an equally-matching in-category shop', () => {
  const inCat  = { id: 'in',  name: 'Laptop Fix', category: 'it_tech' };
  const offCat = { id: 'off', name: 'Laptop Fix', category: 'beauty_wellness' };
  const ranked = rankCandidates([offCat, inCat], { keywords: ['laptop'], category: 'it_tech' });
  assert.equal(ranked[0].id, 'in');
  assert.ok(ranked[0]._score > ranked[1]._score);
});

// ── Regression: the production bug this penalty replaced ────────────────────
// "laptop" parses to electronics_phones. The shop that actually stocks laptops
// was filed under the freeform string "electronics retail" and the old hard
// filter deleted it outright, so the search returned 3 of 12 real products.
test('a freeform category equivalent to the query category is NOT penalized', () => {
  const ethioAmazon = {
    id: 'ethio', name: 'ETHIO-AMAZON ELECTRONICS', category: 'electronics retail',
    _matched_product: { name: 'HP Pavilion Laptop' },
  };
  const ranked = rankCandidates([ethioAmazon], { keywords: ['laptop'], category: 'electronics_phones' });
  assert.equal(ranked[0]._categoryMismatch, false);
  assert.ok(isRelevant(ranked[0]));
});

test('a shop that stocks the product survives even on a true category mismatch', () => {
  // Ahadu is filed under "express shipping and importing" → transport_delivery,
  // a genuine mismatch for an electronics query — but it stocks the laptop.
  const stocksIt = {
    id: 'ahadu', name: 'Ahadu Market And Express', category: 'express shipping and importing',
    _matched_product: { name: 'Gaming Laptop' },
  };
  const inCatEmpty = { id: 'empty', name: 'Miki electronics shop', category: 'electronics_phones' };
  const ranked = rankCandidates([inCatEmpty, stocksIt], { keywords: ['laptop'], category: 'electronics_phones' });
  // Present, relevant, and still ahead of an in-category shop with no match.
  assert.ok(isRelevant(ranked.find(r => r.id === 'ahadu')));
  assert.equal(ranked[0].id, 'ahadu');
});

test('"other" and generic categories are treated as no claim, never a mismatch', () => {
  const rows = [
    { id: 'cartet', name: 'CartEt', category: 'other', _matched_product: { name: 'Iphone 15pro max' } },
    { id: 'gabriel', name: 'Gabriel sales', category: 'retail', _matched_product: { name: 'Iphone 17 pro max' } },
  ];
  const ranked = rankCandidates(rows, { keywords: ['iphone'], category: 'electronics_phones' });
  for (const r of ranked) assert.equal(r._categoryMismatch, false, `${r.id} should not be penalized`);
});

test('the mismatch penalty cannot fully suppress a strong match', () => {
  // Guardrail on tuning: a penalized perfect match must still beat a bare
  // quality prior, or the penalty has become a filter by another name.
  const penalized = {
    id: 'p', name: 'Laptop Repair', category: 'beauty_wellness',
    _matched_product: { name: 'laptop screen' }, _similarity: 0.7,
  };
  const shiny = { id: 's', name: 'General Store', category: 'it_tech', verified: true, average_rating: 5, total_reviews: 200 };
  const ranked = rankCandidates([shiny, penalized], { keywords: ['laptop'], category: 'it_tech' });
  assert.equal(ranked[0].id, 'p');
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

// ── Plan tiebreak ────────────────────────────────────────────────────────────
// Pro buys ranking, never relevance. These tests pin that boundary: if someone
// later raises RANK_WEIGHTS.plan far enough to outrank a real match, they fail.

test('planScore is 1 for Pro, 1 during the trial, 0 for plain Free', () => {
  assert.equal(planScore(PRO), 1);
  assert.equal(planScore(FREE), 0);
  // An unexpired trial counts as Pro — a shop's first month gets the lift.
  const inTrial = {
    plan_tier: 'free',
    subscription_status: 'trial',
    trial_ends_at: new Date(Date.now() + 5 * 86400000).toISOString(),
  };
  assert.equal(planScore(inTrial), 1);
});

test('Pro outranks Free when relevance is otherwise equal', () => {
  const free = { id: 'free', name: 'Laptop Repair', ...FREE };
  const pro  = { id: 'pro',  name: 'Laptop Repair', ...PRO };
  const ranked = rankCandidates([free, pro], { keywords: ['laptop'] });
  assert.equal(ranked[0].id, 'pro');
});

test('Pro CANNOT outrank a genuinely better match on Free', () => {
  // Free shop actually sells the thing; Pro shop is a weak name-only match.
  const freeBetter = {
    id: 'free', name: 'Laptop Repair Bole',
    _matched_product: { name: 'laptop screen' }, _similarity: 0.7, ...FREE,
  };
  const proWeaker = { id: 'pro', name: 'General Store', ...PRO };
  const ranked = rankCandidates([freeBetter, proWeaker], { keywords: ['laptop'] });
  assert.equal(ranked[0].id, 'free');
});

test('plan is a tiebreak — it cannot on its own make an irrelevant shop rank', () => {
  const s = scoreCandidate({ name: 'General Store', ...PRO }, { keywords: ['laptop'] });
  // No keyword/semantic/product signal → score is only the small plan weight.
  assert.ok(s.score <= RANK_WEIGHTS.plan + 1e-9);
});

test('a Pro shop with no match is still not relevant', () => {
  const ranked = rankCandidates([{ id: 'a', name: 'General Store', ...PRO }], { keywords: ['laptop'] });
  assert.equal(isRelevant(ranked[0]), false);
});

test('plan weight stays small enough that product match always wins', () => {
  // Guardrail on tuning: a concrete in-budget product match must outweigh the
  // plan lift by a clear margin, or Pro starts buying its way into results.
  assert.ok(RANK_WEIGHTS.product > RANK_WEIGHTS.plan * 2);
  assert.ok(RANK_WEIGHTS.keyword > RANK_WEIGHTS.plan * 2);
});
