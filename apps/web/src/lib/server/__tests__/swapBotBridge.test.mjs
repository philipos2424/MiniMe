/**
 * The bridge is the only place swap logic meets the search bot, so the one
 * thing tested here in isolation is the callback router. Everything else in
 * this module is I/O glue over units already covered by their own tests.
 *
 * `sw:` vs `sb:` matters: the search bot's existing callbacks all start `sb:`,
 * and a router that swallowed those would silently break search pagination,
 * ratings and feedback — failures nobody would attribute to the swap feature.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSwapCallback } from '../swap/swapBotBridge.mjs';

test('swap callbacks parse into an action and its argument', () => {
  assert.deepEqual(parseSwapCallback('sw:want:abc-123'), { action: 'want', arg: 'abc-123' });
  assert.deepEqual(parseSwapCallback('sw:kind:swap'),    { action: 'kind', arg: 'swap' });
  assert.deepEqual(parseSwapCallback('sw:area:other'),   { action: 'area', arg: 'other' });
  assert.deepEqual(parseSwapCallback('sw:done:i1'),      { action: 'done', arg: 'i1' });
});

test('existing search callbacks are left alone', () => {
  for (const d of ['sb:more:123:0', 'sb:fb:up:9', 'sb:grid:1:0']) {
    assert.equal(parseSwapCallback(d), null, d);
  }
});

test('junk data does not throw', () => {
  for (const d of [null, undefined, '', 'sw', 'sw:', 'nonsense']) {
    assert.doesNotThrow(() => parseSwapCallback(d));
  }
});
