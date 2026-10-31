import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { upgradeText, upgradeKeyboard } from '../../upgradeOffer.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const day = 86400000;

test('free owners see the plans and prices', () => {
  const t = upgradeText({ subscription_status: 'expired', trial_ends_at: new Date(Date.now() - day).toISOString() });
  assert.match(t, /1,300 ETB\* a month/);
  assert.match(t, /3,500 ETB\* for 3 months — save 400/);
  assert.match(t, /12,000 ETB\* for a year — save 3,600/);
});

test('trial owners see days left; paying owners see their end date', () => {
  assert.match(upgradeText({ subscription_status: 'trial', trial_ends_at: new Date(Date.now() + 3 * day).toISOString() }), /3 days left/);
  const exp = new Date(Date.now() + 40 * day).toISOString();
  assert.match(upgradeText({ subscription_status: 'active', subscription_expires_at: exp }), new RegExp(`on MiniMe Pro\\* until ${exp.slice(0, 10)}`));
});

test('button opens checkout in the Mini App', () => {
  assert.equal(upgradeKeyboard('https://app.example/').inline_keyboard[0][0].web_app.url, 'https://app.example/settings/billing?upgrade=1');
  assert.equal(upgradeKeyboard(''), undefined);
});

test('/upgrade is handled and the billing page opens checkout from it', () => {
  assert.match(readFileSync(`${here}../replyEngine.js`, 'utf8'), /\(upgrade\|pro\|subscribe\)/);
  assert.match(readFileSync(`${here}../../../app/(dashboard)/settings/billing/page.js`, 'utf8'), /get\('upgrade'\) === '1'/);
});

test('Mini App honours deep links from bot buttons instead of bouncing to Home', () => {
  const shell = readFileSync(`${here}../../../components/layout/DashboardShell.jsx`, 'utf8');
  assert.doesNotMatch(shell, /if \(isDeepLink\) router\.replace\('\/'\)/);
  assert.match(shell, /Honour the link/);
});
