import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_CATEGORIES, canonicalCategory, canonicalCategoriesOf, matchesCategory,
} from '../categoryMap.mjs';

test('every canonical id maps to itself (except the no-signal "other")', () => {
  for (const id of CANONICAL_CATEGORIES) {
    if (id === 'other') { assert.equal(canonicalCategory(id), null); continue; }
    assert.equal(canonicalCategory(id), id, `${id} must be stable`);
  }
});

test('null/empty/garbage input is null, never a guess', () => {
  for (const v of [null, undefined, '', '   ', 'pigeon breeding', 'keepsake sculpture', 'treading']) {
    assert.equal(canonicalCategory(v), null);
  }
});

test('generic non-claims normalize to null rather than a wrong bucket', () => {
  // These must NOT become 'other' — a null claim is eligible everywhere, while
  // a bucketed claim can be penalized for mismatching.
  for (const v of ['retail', 'retail store', 'online shop', 'e-commerce', 'ecommerce',
                   'services', 'service', 'platform', 'other', 'send me a direct message']) {
    assert.equal(canonicalCategory(v), null, `${v} should carry no signal`);
  }
});

test('trades outside the 15 buckets make no claim rather than a wrong one', () => {
  // Each of these has a stem that WOULD drag it somewhere a buyer would never
  // look for it, so they are excluded before the rules run.
  const cases = {
    'real estate consulting': 'not a consultancy',
    'real estate rental': 'not a rental/transport business',
    'visa services': 'not a courier',
    'customer service': 'not a training provider',
    'used kitchen equipment': 'commercial resale, not interiors',
    'healthcare': 'not a beauty salon',
    'dental services': 'not a beauty salon',
    'automotive sales': 'no vehicle bucket exists',
    'car dealership brokerage': 'no vehicle bucket exists',
  };
  for (const [raw, why] of Object.entries(cases)) {
    assert.equal(canonicalCategory(raw), null, `${raw} — ${why}`);
  }
});

test('the exclusions do not over-reach into neighbouring trades', () => {
  // Narrow exclusions must not swallow the legitimate members of a bucket.
  assert.equal(canonicalCategory('mental health counseling'), 'beauty_wellness'); // not 'healthcare'
  assert.equal(canonicalCategory('car rental'), 'transport_delivery');            // not 'car dealership'
  assert.equal(canonicalCategory('kitchenware'), null);
  assert.equal(canonicalCategory('furniture'), 'construction_interior');          // fitted kitchens land here
  assert.equal(canonicalCategory('customer support software'), 'it_tech');        // not 'customer service'
});

// ── Regression: the exact production values that broke "laptop" search ──────
// Before normalization these were dropped by the ranker's hard category
// filter, hiding 9 of 12 listable laptop/phone products.
test('the shops that vanished from "laptop" search now normalize correctly', () => {
  assert.equal(canonicalCategory('electronics retail'), 'electronics_phones');   // ETHIO-AMAZON, 7 laptops
  assert.equal(canonicalCategory('mobile phone retail'), 'electronics_phones');
  assert.equal(canonicalCategory('computer sales and services'), 'electronics_phones');
  assert.equal(canonicalCategory('electronics repair'), 'electronics_phones');
  assert.equal(canonicalCategory('home appliances'), 'electronics_phones');
  assert.equal(canonicalCategory('nfc products'), 'electronics_phones');
});

test('ordering conflicts resolve to the more specific bucket', () => {
  assert.equal(canonicalCategory('graphic design and printing'), 'printing_signage');
  assert.equal(canonicalCategory('software development and brand design'), 'it_tech');
  assert.equal(canonicalCategory('computer retail'), 'electronics_phones');
  assert.equal(canonicalCategory('food supplier'), 'catering_food');
  assert.equal(canonicalCategory('fitness training'), 'beauty_wellness');
  assert.equal(canonicalCategory('pharmaceutical import'), 'wholesale_supply');
  assert.equal(canonicalCategory('personal development training'), 'training_consulting');
});

test('"barber" is beauty, not a bar', () => {
  assert.equal(canonicalCategory('barber'), 'beauty_wellness');
  assert.equal(canonicalCategory('bar'), 'food_beverage');
});

test('a broad sweep of real production values lands somewhere sane', () => {
  const cases = {
    'web application development': 'it_tech',
    'custom software development': 'it_tech',
    'digital subscriptions': 'it_tech',
    'contact center software': 'it_tech',
    'tech support': 'it_tech',
    'digital marketing': 'branding_design',
    'social media marketing': 'branding_design',
    'promotion services': 'branding_design',
    'copywriting': 'branding_design',
    'photography and videography': 'photography_video',
    'video editing': 'photography_video',
    'business card printing': 'printing_signage',
    'stickers and decals': 'printing_signage',
    'clothing retail': 'clothing_fashion',
    'shoe retail': 'clothing_fashion',
    'retail - footwear': 'clothing_fashion',
    'jewelry': 'clothing_fashion',
    'thrift shop': 'clothing_fashion',
    'perfume retail': 'beauty_wellness',
    'natural skincare and haircare': 'beauty_wellness',
    'mental health counseling': 'beauty_wellness',
    'construction and building materials': 'construction_interior',
    'renewable energy products': 'construction_interior',
    'water treatment': 'construction_interior',
    'furniture': 'construction_interior',
    'express shipping and importing': 'transport_delivery',
    'tour and travel': 'transport_delivery',
    'delivery service': 'transport_delivery',
    'laboratory supplies': 'wholesale_supply',
    'gem stones and minerals': 'wholesale_supply',
    'stationery': 'wholesale_supply',
    'event organization': 'events_entertainment',
    'ticket sales': 'events_entertainment',
    'grocery store': 'food_beverage',
    'fish market': 'food_beverage',
    'food delivery': 'catering_food',
    'business training and opportunity': 'training_consulting',
    'online education and community onboarding': 'training_consulting',
    'recruitment': 'training_consulting',
    'translation services': 'training_consulting',
  };
  for (const [raw, want] of Object.entries(cases)) {
    assert.equal(canonicalCategory(raw), want, `${raw} → expected ${want}`);
  }
});

test('canonicalCategoriesOf merges category + categories[] and dedupes', () => {
  assert.deepEqual(canonicalCategoriesOf({ category: 'electronics retail' }), ['electronics_phones']);
  assert.deepEqual(
    canonicalCategoriesOf({ category: 'electronics retail', categories: ['electronics_phones', 'it services'] }),
    ['electronics_phones', 'it_tech'],
  );
  assert.deepEqual(canonicalCategoriesOf({ category: 'retail', categories: ['other'] }), []);
  assert.deepEqual(canonicalCategoriesOf(null), []);
});

test('a backfilled category_canonical wins over the freeform label', () => {
  const row = { category_canonical: 'it_tech', category: 'electronics retail' };
  assert.deepEqual(canonicalCategoriesOf(row), ['it_tech']);
});

test('matchesCategory is permissive for shops with no usable claim', () => {
  assert.equal(matchesCategory({ category: null }, 'it_tech'), true);
  assert.equal(matchesCategory({ category: 'retail' }, 'it_tech'), true);   // no claim
  assert.equal(matchesCategory({ category: 'other' }, 'it_tech'), true);    // no claim
  assert.equal(matchesCategory({ category: 'electronics retail' }, 'electronics_phones'), true);
  assert.equal(matchesCategory({ category: 'beauty_wellness' }, 'it_tech'), false);
  // An unparseable requested category constrains nothing.
  assert.equal(matchesCategory({ category: 'beauty_wellness' }, 'pigeon breeding'), true);
});
