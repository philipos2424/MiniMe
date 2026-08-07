/**
 * Payment rail safety.
 *
 * Two live bugs prompted these, both from the same instinct — "make it work in
 * demo" — and both catastrophic in production:
 *
 *  1. Each gateway branch fell through to upgradeSubscription() when its key
 *     was missing, returning status:'completed'. With no Stripe/PayPal/Chapa
 *     keys configured, ANY owner could pick one of those methods and be granted
 *     Pro instantly, for free.
 *  2. The manual rails defaulted to phone '+251911000000' and account
 *     '1000000000000', so owners were told to send real money to an account
 *     that belongs to nobody.
 *
 * The route can't be imported here (it pulls in the service-role Supabase
 * client), so these assert against the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const route = readFileSync(`${root}apps/web/src/app/api/payment/subscribe/route.js`, 'utf8');
const modal = readFileSync(`${root}apps/web/src/components/billing/UpgradeModal.jsx`, 'utf8');

test('no payment account has a hardcoded fallback value', () => {
  // A placeholder is fine in a config file and catastrophic on a payment
  // screen. If it isn't configured, the method must be OFF, not wrong.
  // Comments are stripped first — the old values are named in a comment
  // explaining why they're gone, and that should stay.
  const code = route.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  assert.ok(!/\+251911000000/.test(code), 'placeholder phone number is back');
  assert.ok(!/1000000000000/.test(code), 'placeholder account number is back');

  // Every field in PLATFORM_ACCOUNTS must fall back to null, never a string.
  const block = code.match(/PLATFORM_ACCOUNTS = \{[\s\S]*?\n\};/)[0];
  const fallbacks = block.match(/\|\|\s*[^,\n]+/g) || [];
  for (const f of fallbacks) {
    assert.match(f, /\|\|\s*null/, `non-null fallback in PLATFORM_ACCOUNTS: ${f.trim()}`);
  }
});

test('every unconfigured gateway refuses instead of granting Pro', () => {
  // One guard per rail, before any call to upgradeSubscription.
  const guards = route.match(/if \(!simulationAllowed\(\)\) return railUnavailable\('(\w+)'\)/g) || [];
  const rails = guards.map(g => g.match(/'(\w+)'/)[1]).sort();
  assert.deepEqual(rails, ['chapa', 'paypal', 'stripe'], `unguarded gateway fallback: got ${rails}`);

  // Each guard must PRECEDE its upgradeSubscription call.
  for (const m of ['stripe', 'paypal', 'chapa']) {
    const guardAt = route.indexOf(`railUnavailable('${m}')`);
    const grantAt = route.indexOf(`paymentMethod: '${m}'`);
    assert.ok(guardAt > 0 && grantAt > 0 && guardAt < grantAt, `${m}: grant precedes guard`);
  }
});

test('the simulation escape hatch cannot fire in production', () => {
  // Double-gated: explicit opt-in AND a non-production environment.
  assert.match(route, /ALLOW_SIMULATED_PAYMENTS === '1'/);
  assert.match(route, /process\.env\.NODE_ENV !== 'production'/);
  const fn = route.match(/function simulationAllowed\(\)[\s\S]*?\n\}/)[0];
  assert.ok(fn.includes('&&'), 'the two conditions must both be required');
});

test('manual rails refuse when the account is not configured', () => {
  assert.match(route, /if \(isTelebirr \? !acct\.phone : !acct\.account\)/);
});

test('the bank is configurable, not hardcoded to one institution', () => {
  // The owner banks with NBE; the code assumed CBE everywhere.
  assert.match(route, /PLATFORM_BANK_NAME/);
  assert.match(route, /bankName/);
  assert.ok(!/CBE Birr/.test(modal), 'UI still hardcodes CBE');
});

test('the UI only offers rails the server can take money through', () => {
  assert.match(modal, /\/api\/payment\/methods/);
  assert.match(modal, /\.filter\(m => rails === null \|\| rails\[m\.id\]\)/);
});
