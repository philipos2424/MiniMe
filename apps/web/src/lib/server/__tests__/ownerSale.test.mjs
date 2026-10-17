import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseSaleAmount, salePrompt, saleConversationId, manualSaleOrder, saleRecordedText, SOLD_CALLBACK,
} from '../ownerSale.mjs';

const CONV = '0b8f5a52-3c1d-4e6f-9a10-1234567890ab';

test('parseSaleAmount reads the ways owners type money', () => {
  for (const [input, want] of [
    ['1200', 1200], ['1,200', 1200], ['1 200 birr', 1200], ['ETB 1200.50', 1200.5],
    ['1.5k', 1500], ['2k birr', 2000], ['  850 ', 850], ['ብር 600', 600],
  ]) assert.equal(parseSaleAmount(input), want, input);
});

test('parseSaleAmount refuses anything ambiguous or silly', () => {
  for (const input of ['', 'paid', '0', '-5', '2 for 600', '99999999', 'abc 1.2.3']) {
    assert.equal(parseSaleAmount(input), null, input);
  }
});

test('the prompt round-trips its conversation id; other replies are ignored', () => {
  assert.equal(saleConversationId(salePrompt(CONV, 'Abebe')), CONV);
  assert.equal(saleConversationId('✏️ Edit draft ' + CONV), null);
  assert.equal(saleConversationId('💰 Record sale not-a-uuid'), null);
  assert.ok((SOLD_CALLBACK + CONV).length <= 64); // Telegram callback_data limit
});

test('a recorded sale is a paid manual order the rollup will count', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const row = manualSaleOrder({ business: { id: 'b1' }, conversation: { id: CONV, customer_id: 'c1' }, amount: 1200, now });
  assert.equal(row.status, 'paid');                 // allowed by orders_status_check
  assert.equal(row.source, 'manual');               // allowed by orders_source_check
  assert.equal(row.paid_at, now.toISOString());     // rollup counts orders_paid by paid_at
  assert.equal(row.total, 1200);
  assert.equal(row.currency, 'ETB');
  assert.equal(row.customer_id, 'c1');
  assert.equal(row.expires_at, null);
  assert.match(saleRecordedText(1200, 'Abebe'), /1,200 birr sale with Abebe/);
});

test('cards carry the button and the engine checks the chat belongs to the shop', () => {
  const notif = readFileSync(new URL('../notification.js', import.meta.url), 'utf8');
  assert.equal((notif.match(/SOLD_CALLBACK\}\$\{conversationId\}/g) || []).length, 2);
  const engine = readFileSync(new URL('../replyEngine.js', import.meta.url), 'utf8');
  assert.match(engine, /handleOwnerPendingSale\(token, business, msg\)/);
  // Both the button handler and the reply handler scope the chat to this shop.
  assert.equal((engine.match(/\.eq\('id', convId\)\.eq\('business_id', business\.id\)/g) || []).length, 2);
});
