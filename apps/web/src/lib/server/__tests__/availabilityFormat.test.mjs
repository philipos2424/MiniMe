/**
 * Availability arithmetic and wording.
 *
 * The bug this guards: two customers in two separate conversations were both
 * told "1 left" for the same last unit, because stock only moved after payment.
 * An unpaid order now holds its items, and the numbers below are what every
 * prompt quotes.
 *
 * The disclosure rule has teeth too — a customer asking about a product must
 * never learn anything about the customer holding it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateAvailability, formatStock, formatStockCompact, holdsPromptBlock,
} from '../availabilityFormat.mjs';

const p = (over = {}) => ({ id: 'p1', name: 'iConnect Card', stock_quantity: 3, ...over });

test('available = stock − held', () => {
  const [out] = annotateAvailability([p()], { p1: 2 });
  assert.equal(out.stock_quantity, 3);
  assert.equal(out.held_quantity, 2);
  assert.equal(out.available_quantity, 1);
});

test('nothing held leaves the product as it was', () => {
  const [out] = annotateAvailability([p()], {});
  assert.equal(out.held_quantity, 0);
  assert.equal(out.available_quantity, 3);
});

test('holds never exceed stock, and availability never goes negative', () => {
  // Possible in practice: stock edited down by the owner while orders are open.
  const [out] = annotateAvailability([p({ stock_quantity: 1 })], { p1: 5 });
  assert.equal(out.held_quantity, 1);
  assert.equal(out.available_quantity, 0);
});

test("a customer's own hold doesn't block them", () => {
  // They have the only unpaid order for all 3. Adding to their own order must
  // not report the shop as sold out to them.
  const [out] = annotateAvailability([p()], { p1: 3 }, { p1: 3 });
  assert.equal(out.held_quantity, 0);
  assert.equal(out.available_quantity, 3);
});

test('untracked stock stays untracked — null is not zero', () => {
  const [out] = annotateAvailability([p({ stock_quantity: null })], { p1: 2 });
  assert.equal(out.available_quantity, null,
    'a product the owner does not count must not be reported as unavailable');
});

test('annotate is pure — the input products are not mutated', () => {
  const input = p();
  annotateAvailability([input], { p1: 2 });
  assert.equal(input.held_quantity, undefined);
  assert.equal(input.available_quantity, undefined);
});

test('formatStock says what is free, and says why when it differs', () => {
  const [held] = annotateAvailability([p()], { p1: 2 });
  const line = formatStock(held);
  assert.match(line, /2 on hold/);
  assert.match(line, /1 available now/);

  const [free] = annotateAvailability([p()], {});
  assert.equal(formatStock(free), 'stock: 3');

  const [none] = annotateAvailability([p({ stock_quantity: 0 })], {});
  assert.equal(formatStock(none), 'out of stock');

  const [allHeld] = annotateAvailability([p()], { p1: 3 });
  assert.match(formatStock(allHeld), /all 3 on hold/);
  assert.doesNotMatch(formatStock(allHeld), /out of stock/,
    'everything spoken for is not the same claim as an empty shelf');

  const [untracked] = annotateAvailability([p({ stock_quantity: null })], {});
  assert.equal(formatStock(untracked), '', 'nothing to say about untracked stock');
});

test('compact form is empty unless it has something to add', () => {
  const [free] = annotateAvailability([p()], {});
  assert.equal(formatStockCompact(free), '');
  const [held] = annotateAvailability([p()], { p1: 2 });
  assert.match(formatStockCompact(held), /1 free, 2 on hold/);
  const [out] = annotateAvailability([p({ stock_quantity: 0 })], {});
  assert.equal(formatStockCompact(out), ' [OUT]');
});

test('the holds prompt block only appears when something is held', () => {
  assert.equal(holdsPromptBlock(annotateAvailability([p()], {})), '');
  const block = holdsPromptBlock(annotateAvailability([p()], { p1: 2 }));
  assert.notEqual(block, '');
  assert.match(block, /AVAILABLE NOW/);
});

test('the holds prompt block forbids identifying the other customer', () => {
  const block = holdsPromptBlock(annotateAvailability([p()], { p1: 2 }));
  assert.match(block, /NEVER say who holds them/,
    'availability may be shared; the other customer must not be');
});
