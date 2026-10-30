import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  computeProgress, guideText, guideKeyboard, stepStart, basicsQuestion, nextBasics,
  activeAwaiting, normalizeEtPhone, normalizeCbeAccount, cancelsAwaiting, STEP_KEYS,
} from '../setupGuide.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');

test('a brand-new shop starts at step 1, products', () => {
  const p = computeProgress({}, {});
  assert.equal(p.doneCount, 0);
  assert.equal(p.next.key, 'products');
  assert.equal(p.complete, false);
  const t = guideText(p, { ownerFirst: 'Abebe' });
  assert.match(t, /Let's get your shop ready, Abebe/);
  assert.match(t, /0 of 5 done/);
  assert.match(t, /👉 1\. Add what you sell/);
  assert.equal(guideKeyboard(p).inline_keyboard[0][0].callback_data, 'setup_go_products');
});

test('progress comes from real data, so the Mini App counts too', () => {
  const p = computeProgress({ productCount: 3, hasPayment: true, hours: 'Mon–Sat', location: 'Bole' }, { delivery_done: true });
  assert.deepEqual(p.steps.filter(s => s.done).map(s => s.key), ['products', 'payments', 'basics']);
  assert.equal(p.next.key, 'preview');
});

test('skipped steps move the guide on, and everything done = complete', () => {
  const p = computeProgress({ productCount: 1 }, { skipped: ['payments', 'hours', 'location', 'delivery'], previewed: true, shared: true });
  assert.equal(p.complete, true);
  assert.match(guideText(p), /all set/);
  assert.equal(guideKeyboard(p).inline_keyboard[0][0].callback_data, 'owner_inbox');
  assert.equal(computeProgress({}, { skipped: ['products'] }).next.key, 'payments');
});

test('each step has a first message with a way forward', () => {
  for (const k of STEP_KEYS) assert.ok(stepStart(k), k);
  assert.equal(stepStart('products').awaiting, 'product');
  assert.match(stepStart('products').text, /Red dress 1500 birr/);
  assert.deepEqual(stepStart('payments').keyboard.inline_keyboard[0].map(b => b.callback_data), ['setup_pay_telebirr', 'setup_pay_cbe']);
  assert.equal(stepStart('basics').awaiting, 'hours');
  assert.equal(nextBasics('hours'), 'location');
  assert.equal(nextBasics('location'), 'delivery');
  assert.equal(nextBasics('delivery'), null);
  assert.equal(basicsQuestion('delivery').keyboard.inline_keyboard[0][0].callback_data, 'setup_skip_delivery');
});

test('callback data fits Telegram’s 64-byte limit', () => {
  for (const k of [...STEP_KEYS, 'hours', 'location', 'delivery']) {
    for (const d of [`setup_go_${k}`, `setup_skip_${k}`]) assert.ok(Buffer.byteLength(d) <= 64, d);
  }
});

test('a waiting step expires after 30 minutes', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(activeAwaiting({ awaiting: 'hours', awaiting_at: '2026-10-30T11:45:00Z' }, now), 'hours');
  assert.equal(activeAwaiting({ awaiting: 'hours', awaiting_at: '2026-10-30T11:00:00Z' }, now), null);
  assert.equal(activeAwaiting({ awaiting: 'bogus', awaiting_at: '2026-10-30T11:59:00Z' }, now), null);
  assert.equal(activeAwaiting(null, now), null);
});

test('payment numbers are checked before saving', () => {
  assert.equal(normalizeEtPhone('0911 234 567'), '+251911234567');
  assert.equal(normalizeEtPhone('+251 711 234 567'), '+251711234567');
  assert.equal(normalizeEtPhone('911234567'), '+251911234567');
  assert.equal(normalizeEtPhone('12345'), null);
  assert.equal(normalizeCbeAccount('1000 1234 56789'), '1000123456789');
  assert.equal(normalizeCbeAccount('100012345'), null);
});

test('a command or "cancel" ends a waiting step', () => {
  assert.ok(cancelsAwaiting('/orders'));
  assert.ok(cancelsAwaiting('cancel'));
  assert.ok(!cancelsAwaiting('Mon–Sat 9 to 6'));
});

test('the bot wires the guide in: answers, /setup, /start, buttons, owner only', () => {
  const eng = read('../replyEngine.js');
  assert.match(eng, /handleSetupAnswer\(\{ token, business, chatId, msg \}\)/);
  assert.match(eng, /Number\(msg\.from\?\.id\) === Number\(business\.owner_telegram_id\)\) \{/);
  assert.match(eng, /\/\^\\\/setup/);
  assert.match(eng, /guideNext = await setupIncomplete\(business\)/);
  assert.match(eng, /callback_data: 'setup_open'/);
  const cb = eng.slice(eng.indexOf("if (data.startsWith('setup_')) {"), eng.indexOf("if (data === 'owner_inbox')"));
  assert.match(cb, /Only the shop owner can do this/);
  assert.doesNotMatch(cb, /sub_admin_telegram_ids/);
});

test('basics only asks what the profile is missing', async () => {
  const { nextOpenBasics } = await import('../setupGuide.mjs');
  assert.equal(nextOpenBasics({ hours: '24/7', location: 'Addis Ababa' }, {}), 'delivery');
  assert.equal(nextOpenBasics({}, {}), 'hours');
  assert.equal(nextOpenBasics({ hours: 'x' }, { skipped: ['location'] }), 'delivery');
  assert.equal(nextOpenBasics({ hours: 'x', location: 'y' }, { delivery_done: true }), null);
  assert.equal(nextOpenBasics({}, {}, 'location'), 'location');
});

test('the share link survives Markdown (underscores broke step 5 live)', async () => {
  const { mdEscape } = await import('../setupGuide.mjs');
  assert.equal(mdEscape('https://a.app/shop/ab_cd'), 'https://a.app/shop/ab\\_cd');
  const run = read('../setupGuideRun.js');
  assert.match(run, /🔗 \$\{mdEscape\(link\)\}/);
  assert.match(run, /parse entities/);
  assert.doesNotMatch(run.replace(/async function say[\s\S]*?\n}\n/, ''), /tg\(token, 'sendMessage'/);
});
