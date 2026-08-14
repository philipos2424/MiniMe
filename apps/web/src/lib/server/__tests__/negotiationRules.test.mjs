import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOfferDeterministic } from '../negotiationRules.mjs';

test('sell: an offer at or above the floor is accepted by arithmetic, no model needed', () => {
  const r = evaluateOfferDeterministic({ amount: 30000, limits: { min_sell_price: 25000 }, direction: 'sell' });
  assert.equal(r.action, 'accept');
});

test('sell: an offer below the floor counters at exactly the floor', () => {
  const r = evaluateOfferDeterministic({ amount: 15000, limits: { min_sell_price: 25000 }, direction: 'sell' });
  assert.equal(r.action, 'counter');
  assert.equal(r.counterAmount, 25000);
});

test('buy: an offer at or below the ceiling is accepted', () => {
  const r = evaluateOfferDeterministic({ amount: 8000, limits: { max_budget_buy: 10000 }, direction: 'buy' });
  assert.equal(r.action, 'accept');
});

test('buy: an offer above the ceiling is declined, never silently overpaid', () => {
  const r = evaluateOfferDeterministic({ amount: 12000, limits: { max_budget_buy: 10000 }, direction: 'buy' });
  assert.equal(r.action, 'decline');
});

test('no limit configured defers to the model rather than guessing a number', () => {
  assert.equal(evaluateOfferDeterministic({ amount: 5000, limits: {}, direction: 'sell' }), null);
  assert.equal(evaluateOfferDeterministic({ amount: 5000, limits: {}, direction: 'buy' }), null);
});

test('an unparseable amount defers rather than coercing to a number', () => {
  assert.equal(evaluateOfferDeterministic({ amount: 'a lot', limits: { min_sell_price: 100 }, direction: 'sell' }), null);
  assert.equal(evaluateOfferDeterministic({ amount: undefined, limits: { min_sell_price: 100 }, direction: 'sell' }), null);
});

test('an unknown direction defers rather than guessing which limit applies', () => {
  assert.equal(evaluateOfferDeterministic({ amount: 5000, limits: { min_sell_price: 100, max_budget_buy: 100000 }, direction: 'trade' }), null);
});
