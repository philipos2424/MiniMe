import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizeIntake, intakeUseful, assemblyLines, assemblyText, intakeMissing, intakeSummary,
  intakeSummaryKeyboard, intakeQuestion, intakeKeyboard, MAX_INTAKE_PRODUCTS,
} from '../setupIntake.mjs';
import { computeProgress, guideKeyboard, AWAITING } from '../setupGuide.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');

const shoe = JSON.stringify({
  track: 'shop', category: 'clothing_fashion', about: 'Shoe shop in Merkato',
  products: [{ name: 'Nike Air', price: 3500 }, { name: 'Sandals', price: '900 birr' }, { name: 'nike air', price: 3600 }, { name: 'Boots', price: null }],
  hours: 'Mon–Sat 9–7', location: 'Merkato', delivery: 'Addis 150 birr', telebirr: '0911 234 567', cbe: '123', facts: ['Sizes 36–45', 'null'],
});

test('the AI answer becomes clean, validated setup data', () => {
  const i = normalizeIntake('Sure! ' + shoe);
  assert.deepEqual(i.products.map(p => [p.name, p.price]), [['Nike Air', 3500], ['Sandals', 900]]);
  assert.deepEqual(i.unpriced, ['Boots']);
  assert.equal(i.telebirr, '+251911234567');
  assert.equal(i.cbe, null, 'a 3-digit CBE number is rejected');
  assert.deepEqual(i.facts, ['Sizes 36–45']);
  assert.equal(i.track, 'shop');
  assert.equal(i.category, 'clothing_fashion');
});

test('garbage never throws, and nothing useful means ask again', () => {
  for (const bad of ['', 'not json', '{"products":"x"}', null, 42]) {
    const i = normalizeIntake(bad);
    assert.equal(intakeUseful(i), false);
  }
  assert.equal(normalizeIntake({ category: 'spaceships' }).category, null);
});

test('Secretary only when nothing is for sale', () => {
  assert.equal(normalizeIntake({ track: 'secretary' }).track, 'secretary');
  assert.equal(intakeUseful(normalizeIntake({ track: 'secretary' })), true);
  assert.equal(normalizeIntake({ track: 'secretary', products: [{ name: 'Cake', price: 500 }] }).track, 'shop');
});

test('product list is capped', () => {
  const many = { products: Array.from({ length: 80 }, (_, n) => ({ name: `Item ${n}`, price: n + 1 })) };
  assert.equal(normalizeIntake(many).products.length, MAX_INTAKE_PRODUCTS);
});

test('the live message only claims what was really done', () => {
  const i = normalizeIntake(shoe);
  const lines = assemblyLines(i);
  assert.equal(lines.length, 6);
  const t0 = assemblyText(i, 0);
  assert.match(t0, /Setting up/);
  assert.match(t0, /⏳ 2 products/);
  const done = assemblyText(i, lines.length);
  assert.match(done, /set up\*/);
  assert.equal((done.match(/✅/g) || []).length, 6);
  assert.equal(assemblyLines(normalizeIntake({ hours: '9-5' })).length, 1);
});

test('summary shows what is missing and offers the next step', () => {
  const only = normalizeIntake({ products: [{ name: 'Shiro', price: 120 }] });
  assert.deepEqual(intakeMissing(only), ['payments', 'location', 'hours', 'delivery']);
  assert.deepEqual(intakeMissing(only, { hasPayment: true, location: 'Bole', hours: '24/7', deliveryDone: true }), []);
  assert.equal(intakeSummaryKeyboard(only, { hasPayment: true }).inline_keyboard[0][0].callback_data, 'setup_go_basics');
  const t = intakeSummary(only);
  assert.match(t, /Shiro — 120 ETB/);
  assert.match(t, /Still need:/);
  const kb = intakeSummaryKeyboard(only).inline_keyboard.flat().map(b => b.callback_data);
  assert.equal(kb[0], 'setup_go_payments');
  assert.ok(kb.includes('setup_run_preview') && kb.includes('setup_intake_fix') && kb.includes('setup_open'));
  const full = normalizeIntake(shoe);
  assert.deepEqual(intakeMissing(full), []);
  assert.match(intakeSummary(full), /everything I need/);
  assert.match(intakeSummary(full), /No price yet for: Boots/);
  assert.equal(intakeSummaryKeyboard(full).inline_keyboard[0][0].callback_data, 'setup_run_preview');
});

test('the opening question offers Secretary and step-by-step', () => {
  assert.match(intakeQuestion('Abebe'), /Hi Abebe/);
  const cbs = intakeKeyboard().inline_keyboard.flat().map(b => b.callback_data);
  assert.deepEqual(cbs, ['setup_track_secretary', 'setup_track_shop']);
  assert.ok(AWAITING.includes('intake'));
});

test('shop guide offers the one-message route while products are missing', () => {
  const p = computeProgress({}, { track: 'shop' });
  assert.ok(guideKeyboard(p).inline_keyboard.flat().some(b => b.callback_data === 'setup_intake'));
});

test('wiring: a new owner gets the question, the answer runs the intake', () => {
  const run = read('../setupGuideRun.js');
  assert.match(run, /!p\.chosen && !business\.notification_prefs\?\.setup\?\.intake_done/);
  assert.match(run, /awaiting === 'intake'[\s\S]{0,200}runIntake/);
  assert.match(run, /rest === 'intake_fix'/);
  const io = read('../setupIntakeRun.js');
  assert.match(io, /bypass_credit_check: true/);
  assert.match(io, /PLACEHOLDER_NAME\.test/, 'never overwrites a real shop name');
});

test('Mini App: describe-everything uses the same intake, behind Telegram auth', () => {
  const route = read('../../../app/api/onboarding/intake/route.js');
  assert.match(route, /verifyTelegramInitData/);
  assert.match(route, /rateLimit\(/);
  assert.match(route, /extractIntake[\s\S]*applyIntake/);
  const ui = read('../../../components/onboarding/GuidedOnboarding.jsx');
  assert.match(ui, /\/api\/onboarding\/intake/);
  assert.match(ui, /describe everything in one message/);
});
