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
const settings = readFileSync(`${root}apps/web/src/lib/server/platformSettings.js`, 'utf8');
const migration = readFileSync(`${root}packages/db/migrations/038_platform_settings.sql`, 'utf8');

test('no payment account has a hardcoded fallback value', () => {
  // A placeholder is fine in a config file and catastrophic on a payment
  // screen. If it isn't configured, the method must be OFF, not wrong.
  // Comments are stripped first — the old values are named in a comment
  // explaining why they're gone, and that should stay.
  for (const [name, src] of [['route', route], ['settings', settings]]) {
    const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    assert.ok(!/\+251911000000/.test(code), `${name}: placeholder phone number is back`);
    assert.ok(!/1000000000000/.test(code), `${name}: placeholder account number is back`);
  }

  // platformAccounts() must pass settings straight through — a `|| 'something'`
  // here would reintroduce exactly the bug, one indirection further away.
  const fn = route.match(/export async function platformAccounts\(\)[\s\S]*?\n\}/)[0];
  const fallbacks = fn.match(/\|\|\s*[^,\n]+/g) || [];
  for (const f of fallbacks) {
    assert.match(f, /\|\|\s*null/, `non-null fallback in platformAccounts: ${f.trim()}`);
  }
});

test('an unset or placeholder setting resolves to null, never a stand-in', () => {
  assert.match(settings, /if \(!envVal\) return null;/);
  assert.match(settings, /placeholder\/i\.test\(envVal\) \? null : envVal/);
});

test('secret settings are encrypted at rest and never returned to the client', () => {
  assert.match(settings, /value: def\.secret \? encrypt\(val\) : val/);
  // describeSettings must not leak a secret's value.
  const desc = settings.match(/export async function describeSettings\(\)[\s\S]*?\n\}/)[0];
  assert.match(desc, /value: d\.secret \? null :/);
});

test('clearing a field removes the setting rather than storing an empty value', () => {
  // An empty string must turn the rail OFF, not become the account number.
  assert.match(settings, /if \(!val\) \{ clears\.push\(key\); continue; \}/);
});

test('the settings table is not readable through the public Supabase URL', () => {
  // It holds encrypted gateway credentials; RLS on with no policies means the
  // anon/authenticated PostgREST roles get nothing, while service-role bypasses.
  assert.match(migration, /ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY/);
  assert.ok(!/CREATE POLICY/i.test(migration), 'a policy would expose the table to anon');
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
