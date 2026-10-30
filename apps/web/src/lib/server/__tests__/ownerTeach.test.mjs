import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  priceIn, captionWantsProduct, photoLooksLikeProduct, validateNewProduct,
  productAddedText, factSavedText, photoProductsText,
} from '../ownerTeach.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}../${f}`, 'utf8');

test('priceIn reads birr / ETB / ብር, with commas', () => {
  assert.equal(priceIn('Red dress 1,500 birr'), 1500);
  assert.equal(priceIn('ETB 250'), 250);
  assert.equal(priceIn('ቡና 120 ብር'), 120);
  assert.equal(priceIn('size 42'), null);
  assert.equal(priceIn(''), null);
});

test('a product caption is added straight away', () => {
  assert.ok(captionWantsProduct('Red dress 1500 birr'));
  assert.ok(captionWantsProduct('new arrival, for sale'));
  assert.ok(captionWantsProduct('አዲስ ጫማ'));
});

test('file, stock and empty captions are not products', () => {
  assert.equal(captionWantsProduct(''), false);
  assert.equal(captionWantsProduct('save as menu'), false);
  assert.equal(captionWantsProduct('price list 2026'), false);
  assert.equal(captionWantsProduct('received stock 20 birr each'), false);
  assert.equal(captionWantsProduct('payment receipt 500 birr'), false);
  assert.equal(captionWantsProduct('our shop at night'), false);
});

test('a photo showing a price is offered as a product', () => {
  assert.ok(photoLooksLikeProduct('A leather bag. Tag reads 2,300 ETB.'));
  assert.equal(photoLooksLikeProduct('A storefront with a blue sign.'), false);
});

test('validateNewProduct needs a name and a positive price', () => {
  assert.equal(validateNewProduct({ name: 'x', price: 5 }).ok, false);
  assert.match(validateNewProduct({ name: 'Injera', price: 0 }).error, /price/);
  assert.match(validateNewProduct({ name: 'Injera' }).error, /price/);
  const ok = validateNewProduct({ name: '  Kitfo   special ', price: '1,200', stock: 7.9 });
  assert.deepEqual(ok, { ok: true, product: { name: 'Kitfo special', price: 1200, stock: 7 } });
  assert.equal(validateNewProduct({ name: 'Tea', price: 30, stock: -2 }).product.stock, null);
});

test('confirmations say what happens next', () => {
  assert.match(productAddedText({ name: 'Tea', price: 30, stock: null }), /Customers can ask about it and order it/);
  assert.match(productAddedText({ name: 'Tea', price: 30 }), /Send a photo/);
  assert.doesNotMatch(productAddedText({ name: 'Tea', price: 30 }, { hasPhoto: true }), /Send a photo/);
  assert.match(factSavedText('We deliver on Saturdays'), /Saturdays/);
  const t = photoProductsText([{ name: 'Bag', price: 2300, created: true }]);
  assert.match(t, /Bag\* — 2,300 ETB/);
});

test('owner agent has the add_product and save_business_info tools, wired to handlers', () => {
  const src = read('ownerCommands.js');
  for (const name of ['add_product', 'save_business_info']) {
    assert.match(src, new RegExp(`name: '${name}'`));
    assert.match(src, new RegExp(`c\\.function\\.name === '${name}'`));
  }
  assert.match(src, /Never just say "got it"/);
  assert.match(src, /isPaymentDetailFact\(text\)/);
});

test('owner photo path turns a product photo into a product, and offers it otherwise', () => {
  const src = read('replyEngine.js');
  assert.match(src, /captionWantsProduct\(msg\.caption\)/);
  assert.match(src, /callback_data: 'addprod_photo'/);
  assert.match(src, /data === 'addprod_photo'/);
  // The button re-reads the photo without saving it to knowledge twice.
  const cb = src.slice(src.indexOf("data === 'addprod_photo'"), src.indexOf("data === 'noop'"));
  assert.match(cb, /describeOwnerPhoto/);
  assert.doesNotMatch(cb, /teachFromPhoto/);
  assert.match(cb, /sub_admin_telegram_ids/);
});
