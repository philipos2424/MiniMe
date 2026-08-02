/**
 * Run: node --test tests/negotiation-evaluate.test.mjs
 * evaluateQuote is the deterministic accept/counter/walk_away/escalate gate —
 * it must never call an LLM. This is a pure function of round/target/walk-away math.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuote } from '../apps/bot/src/services/negotiation.js';

const base = { round: 0, max_rounds: 3, target_price: 100, walk_away_price: 130 };

test('quote at or below target → accept', () => {
  assert.equal(evaluateQuote(base, { unit_price: 100 }), 'accept');
  assert.equal(evaluateQuote(base, { unit_price: 90 }), 'accept');
});

test('quote above walk-away price → walk_away', () => {
  assert.equal(evaluateQuote(base, { unit_price: 131 }), 'walk_away');
  assert.equal(evaluateQuote(base, { unit_price: 500 }), 'walk_away');
});

test('quote between target and walk-away, rounds remaining → counter', () => {
  assert.equal(evaluateQuote({ ...base, round: 0 }, { unit_price: 115 }), 'counter');
  assert.equal(evaluateQuote({ ...base, round: 2 }, { unit_price: 115 }), 'counter');
});

test('quote between target and walk-away, final round reached → escalate', () => {
  assert.equal(evaluateQuote({ ...base, round: 3 }, { unit_price: 115 }), 'escalate');
  assert.equal(evaluateQuote({ ...base, round: 4 }, { unit_price: 129 }), 'escalate');
});

test('boundary: exactly at walk_away_price is still acceptable-band, not walk_away', () => {
  assert.equal(evaluateQuote({ ...base, round: 0 }, { unit_price: 130 }), 'counter');
});

test('boundary: exactly at target_price accepts even on the final round', () => {
  assert.equal(evaluateQuote({ ...base, round: 3 }, { unit_price: 100 }), 'accept');
});
