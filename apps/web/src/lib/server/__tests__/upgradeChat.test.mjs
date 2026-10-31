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

test('reminders: payment ones carry plan buttons, setup ones open the chat guide', async () => {
  const { nudgeKeyboard, mentionsUpgrade, daysUntilProEnd, proEndText } = await import('../../upgradeChat.mjs');
  for (const t of ['trial_ending_5d', 'pro_renewal', 'pro_lapsed']) assert.equal(nudgeKeyboard(t, 'https://a.b').inline_keyboard[0][0].callback_data, 'upg_plan_pro_monthly');
  assert.equal(nudgeKeyboard('no_products', 'https://a.b').inline_keyboard[0][0].callback_data, 'setup_open');
  assert.equal(nudgeKeyboard('inactive_14d', 'https://a.b').inline_keyboard[0][0].web_app.url, 'https://a.b');
  assert.equal(mentionsUpgrade('…\n\n/upgrade to keep it fully automatic.'), true);
  assert.equal(mentionsUpgrade('no upgrade here'), false);
  const now = Date.parse('2026-10-31T09:00:00Z');
  const b = { name: 'Shop', owner_name: 'Abebe K', subscription_status: 'active', subscription_expires_at: '2026-11-03T09:00:00Z' };
  assert.equal(Math.round(daysUntilProEnd(b, now)), 3);
  assert.equal(daysUntilProEnd({ ...b, subscription_expires_at: null }, now), null);
  assert.equal(daysUntilProEnd({ ...b, subscription_status: 'trial' }, now), null);
  assert.match(proEndText('pro_renewal', b, 3), /ends in \*3 days\*/);
  assert.match(proEndText('pro_lapsed', b, -1), /ended on/);
});

test('every place that says /upgrade now shows the plan buttons', () => {
  const nudges = readFileSync(`${here}../../../app/api/cron/owner-nudges/route.js`, 'utf8');
  assert.match(nudges, /nudgeKeyboard\(type, url\)/);
  assert.match(nudges, /return 'pro_renewal'/);
  assert.match(nudges, /daysToProEnd: daysUntilProEnd\(b, now\)/);
  assert.match(readFileSync(`${here}../../../app/api/cron/outreach-rules/route.js`, 'utf8'), /if \(mentionsUpgrade\(text\)\) replyMarkup = planKeyboard/);
  assert.match(readFileSync(`${here}../../../app/api/agent-bot/webhook/route.js`, 'utf8'), /upgradeChat\.mjs'\)\)\.planKeyboard/);
  const e = readFileSync(`${here}../replyEngine.js`, 'utf8');
  assert.equal((e.match(/upgradeChat\.mjs'\)\)\.planKeyboard/g) || []).length, 2);
});
