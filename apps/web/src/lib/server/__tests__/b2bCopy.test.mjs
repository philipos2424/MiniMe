import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { b2bDraftSystemPrompt, warmIntroCopy, cleanContext, hasUnfilledPlaceholder } from '../b2bCopy.mjs';

const read = f => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

test('the draft prompt carries what the shop actually sells', () => {
  const p = b2bDraftSystemPrompt({
    name: 'iconnect',
    description: 'we sell nfc products and minime that is your agent in your telegram',
    products: [{ name: 'Metal NFC card', price: 1500, currency: 'ETB' }],
    rules: ['don’t confuse iConnect with MiniMe.'],
  });
  assert.match(p, /we sell nfc products/);
  assert.match(p, /Metal NFC card: 1500 ETB/);
  assert.match(p, /Only offer products or services listed above/);
  assert.match(p, /Do not propose a call/);
  assert.match(p, /don’t confuse iConnect with MiniMe/);
  assert.doesNotMatch(p, /Be concrete about availability, price/);
});

test('"your inquiry" is never quoted to anyone', () => {
  assert.equal(cleanContext('your inquiry'), '');
  assert.equal(cleanContext('  Your Request '), '');
  assert.equal(cleanContext('branding agency'), 'branding agency');
  const { toTarget, toOwner } = warmIntroCopy({ context: 'your inquiry' });
  assert.doesNotMatch(toTarget + toOwner, /your inquiry/i);
  assert.equal(toTarget, "Hi! I found you through MiniMe and I'd like to connect.");
});

test('the owner is told they found the other business, not the reverse', () => {
  const { toOwner } = warmIntroCopy({ context: 'printing' });
  assert.equal(toOwner, 'You found them through your MiniMe search for "printing".');
  assert.doesNotMatch(toOwner, /They found you/);
});

test('a note from the owner is kept', () => {
  assert.equal(warmIntroCopy({ context: 'printing', note: 'Need 500 flyers.' }).toTarget, 'Hi! Following up on my search for "printing". Need 500 flyers.');
  assert.equal(warmIntroCopy({ note: 'Need 500 flyers.' }).toTarget, 'Hi! Need 500 flyers.');
});

test('unfilled placeholders are caught', () => {
  for (const bad of [
    'Hi ${name}, thanks!', 'Hi {{business}}!', 'Price: undefined ETB', 'Total NaN', '[object Object]',
    'Dear <CUSTOMER_NAME>,', 'Hi [Name], we can help', 'searching for "your inquiry" and',
  ]) assert.equal(hasUnfilledPlaceholder(bad), true, bad);
  for (const ok of [
    "Hi! Thanks for reaching out. We make NFC business cards from 1500 ETB.",
    'Our metal card is undefinedly durable', 'We answer your inquiry within a day.',
  ]) assert.equal(hasUnfilledPlaceholder(ok), false, ok);
});

test('every partner send path refuses placeholder text, and callers no longer default to "your inquiry"', () => {
  const b2b = read('../b2b.js');
  assert.match(b2b, /hasUnfilledPlaceholder\(content\)[\s\S]{0,200}unfilled_placeholder/);
  assert.equal((b2b.match(/hasUnfilledPlaceholder\(content\)/g) || []).length >= 2, true, 'sendBusinessMessage and recordReply');
  assert.ok(!read('../ownerCommands.js').includes("'your inquiry'"));
  assert.ok(!read('../../../app/api/b2b/route.js').includes("'your inquiry'"));
  const engine = read('../replyEngine.js');
  assert.ok(engine.includes('b2bDraftSystemPrompt('), '"Let MiniMe answer" uses the grounded prompt');
  assert.ok(!engine.includes('Be concrete about availability, price, or next step'));
});
