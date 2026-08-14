/**
 * Category precision for the B2B research agent.
 *
 * research.js used to carry its own 100-entry lookup (categoryMap /
 * mapCategoryToDB) that fed `.ilike('category', ...)` against the raw
 * freeform `businesses.category` column — never `category_canonical` — and
 * substring-matched 2-char keys like `['it', 'it_tech']`, so any query
 * containing "it" could be dragged into tech. It has been deleted; research.js
 * now feeds the AI-inferred phrase through canonicalCategory(), the same
 * documented single source of truth the consumer directory uses, and
 * discovery applies it as a ranking penalty (searchRanker.rankCandidates),
 * never a hard filter — which is what makes the 446-of-887 businesses with no
 * category_canonical findable instead of invisible.
 *
 * These cases are the AI-inferred-style short phrases for real campaign
 * queries pulled from the live research_campaigns table, including the
 * confusion traps the taxonomy is deliberately ordered to avoid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCategory } from '../categoryMap.mjs';

test('real campaign queries resolve to the correct canonical bucket', () => {
  const cases = {
    // from research_campaigns.query, as inferCategory would shorten them
    'laptops': 'electronics_phones',
    'coffee': 'food_beverage',
    'branding': 'branding_design',
    'office furniture': 'construction_interior',
    'nfc cards': 'electronics_phones',
  };
  for (const [phrase, expected] of Object.entries(cases)) {
    assert.equal(canonicalCategory(phrase), expected, `"${phrase}" should map to ${expected}`);
  }
});

test('confusion traps stay on the correct side of the ordering', () => {
  // printing before branding — a print shop must not be filed as an agency
  assert.equal(canonicalCategory('graphic design and printing'), 'printing_signage');
  assert.equal(canonicalCategory('business cards'), 'printing_signage');
  // electronics before it_tech — hardware retail is not a dev shop
  assert.equal(canonicalCategory('computer retail'), 'electronics_phones');
  assert.equal(canonicalCategory('laptop retail'), 'electronics_phones');
  // it_tech before branding — a software dev shop is not an agency
  assert.equal(canonicalCategory('software development and brand design'), 'it_tech');
  // catering before food_beverage — trade supply is not a restaurant
  assert.equal(canonicalCategory('food supplier'), 'catering_food');
  assert.equal(canonicalCategory('catering'), 'catering_food');
});

test('generic B2B-partnership-style phrasing carries no signal, not a wrong bucket', () => {
  // These are the free-text "who would benefit from our platform" campaigns —
  // must not be forced into an arbitrary category that then penalizes every
  // real business that doesn't happen to match it.
  for (const phrase of ['small business', 'business services', 'b2b partnership', 'marketplace partners', 'ai automation']) {
    assert.equal(canonicalCategory(phrase), null, `"${phrase}" should carry no signal`);
  }
});

test('real estate and retail never masquerade as a canonical bucket', () => {
  assert.equal(canonicalCategory('real estate'), null);
  assert.equal(canonicalCategory('real estate consulting'), null);
  assert.equal(canonicalCategory('retail'), null);
  assert.equal(canonicalCategory('other'), null);
  assert.equal(canonicalCategory('services'), null);
});
