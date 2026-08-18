import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStage, STAGES } from '../reengage/stages.mjs';

const biz = { id: 'b1', name: 'Selam Shop' };

test('no business row and only a Sell tap is the top rung', () => {
  assert.equal(detectStage({ steps: ['sell_cta_tapped'], business: null }), 'A1');
});

test('a dropped tour step still counts as A1, not as nothing', () => {
  assert.equal(detectStage({ steps: ['tour_started'], business: null }), 'A1');
});

test('a business row with no shop name saved is B1, not A1', () => {
  // The row is created at the "Let's go" tap with a placeholder name, so its
  // mere existence does not mean the owner named their shop.
  assert.equal(detectStage({ steps: ['signup'], business: biz }), 'B1');
});

test('naming the shop advances to B2', () => {
  assert.equal(detectStage({ steps: ['signup', 'shop_name_saved'], business: biz }), 'B2');
});

test('skipping the chat counts as finishing it', () => {
  assert.equal(detectStage({ steps: ['shop_name_saved', 'customer_chat_skipped'], business: biz }), 'B3');
});

test('a replied try-it with no connect attempt is B4', () => {
  assert.equal(detectStage({ steps: ['shop_name_saved', 'customer_chat_finished', 'tryit_replied'], business: biz }), 'B4');
});

test('starting the custom-bot connect is B5', () => {
  assert.equal(detectStage({ steps: ['tryit_replied', 'connect_custom'], business: biz }), 'B5');
});

test('a completed connection is not a stall at all', () => {
  assert.equal(detectStage({ steps: ['connect_custom', 'connected_custom'], business: biz }), null);
  assert.equal(detectStage({ steps: ['connect_shared', 'connected_shared'], business: biz }), null);
});

test('event order never matters — only the furthest rung reached', () => {
  const forward = detectStage({ steps: ['signup', 'shop_name_saved', 'tryit_replied'], business: biz });
  const shuffled = detectStage({ steps: ['tryit_replied', 'shop_name_saved', 'signup'], business: biz });
  assert.equal(forward, shuffled);
});

test('an empty history with no business row is not a candidate', () => {
  assert.equal(detectStage({ steps: [], business: null }), null);
});

test('stages are exported in funnel order', () => {
  assert.deepEqual(STAGES, ['A1', 'B1', 'B2', 'B3', 'B4', 'B5']);
});
