import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planKeyboard, methodKeyboard, payInstructions, extractBankRef, activeUpgrade, resultText, refCode } from '../../upgradeChat.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const accounts = { telebirr: { phone: '+251900000001', name: 'Shop Owner' }, bank: { bankName: 'CBE', account: '1000000000001', name: 'Owner' } };

test('plan buttons pay in chat; the app is the fallback', () => {
  const kb = planKeyboard('https://app.example');
  const data = kb.inline_keyboard.flat().map(b => b.callback_data || b.web_app?.url);
  assert.deepEqual(data, ['upg_plan_pro_monthly', 'upg_plan_pro_quarterly', 'upg_plan_pro_annual', 'https://app.example/settings/billing?upgrade=1']);
  assert.match(kb.inline_keyboard[1][0].text, /3,500 ETB \(save 400\)/);
  for (const c of data) assert.ok(Buffer.byteLength(c) <= 64);
  assert.equal(planKeyboard('').inline_keyboard.length, 3);
});

test('only configured payment methods are offered', () => {
  assert.deepEqual(methodKeyboard('pro_annual', { telebirr: true, bank: false }).inline_keyboard[0].map(b => b.callback_data), ['upg_pay_pro_annual_telebirr']);
});

test('instructions carry amount, account and reference, never a placeholder', () => {
  const t = payInstructions({ planKey: 'pro_quarterly', method: 'telebirr', accounts, businessId: 'debb2f5c-1111' });
  assert.match(t, /3,500 ETB/);
  assert.match(t, /\+251900000001/);
  assert.match(t, /SUB-DEBB2F/);
  assert.match(t, /screenshot/);
  assert.equal(payInstructions({ planKey: 'pro_monthly', method: 'telebirr', accounts: { telebirr: {} }, businessId: 'x' }), null);
  assert.equal(refCode('abcdef12'), 'SUB-ABCDEF');
});

test('transaction numbers are found in captions; our ref and phones are not', () => {
  assert.equal(extractBankRef('paid! CH12AB34CD'), 'CH12AB34CD');
  assert.equal(extractBankRef('FT24301ABC12 thanks'), 'FT24301ABC12');
  assert.equal(extractBankRef('ref SUBDEBB2F 251911223344'), null);
  assert.equal(extractBankRef('hello there'), null);
});

test('a pending payment expires after 48 hours', () => {
  const now = new Date('2026-10-31T10:00:00Z');
  assert.ok(activeUpgrade({ awaiting_sub_proof: { txRef: 't', at: '2026-10-30T12:00:00Z' } }, now));
  assert.equal(activeUpgrade({ awaiting_sub_proof: { txRef: 't', at: '2026-10-28T12:00:00Z' } }, now), null);
  assert.equal(activeUpgrade({}, now), null);
});

test('result messages', () => {
  assert.match(resultText(409, { message: 'That transaction number has already been used' }), /already been used/);
  assert.match(resultText(200, { status: 'verifying' }), /Checking/);
  assert.equal(resultText(200, { status: 'active' }), null);
});

test('wired: /upgrade sends the chat offer, upg_ buttons are owner-only, proof is caught before other photo handling', () => {
  const e = readFileSync(`${here}../replyEngine.js`, 'utf8');
  assert.match(e, /sendUpgradeOffer\(/);
  const at = e.indexOf("if (data.startsWith('upg_')) {");
  assert.ok(at > 0);
  assert.match(e.slice(at, at + 250), /Only the shop owner/);
  assert.ok(e.indexOf('handleUpgradeProof(') < e.indexOf('handleSetupAnswer('));
  const route = readFileSync(`${here}../../../app/api/payment/subscribe/proof/route.js`, 'utf8');
  assert.match(route, /submitSubscriptionProof\(/);
  assert.match(route, /payment_ref !== txRef/);
  assert.match(readFileSync(`${here}../subscriptionProof.js`, 'utf8'), /signProofUrl\(sb, proofUrl/);
});
