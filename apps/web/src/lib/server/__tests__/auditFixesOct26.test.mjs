/**
 * Regressions from the Oct 26 2026 Settings & Admin audit: plan label, export,
 * share link, payment proof review, and payment numbers in learned facts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planLabel } from '../../plan.js';
import { customerShopLink, brandedWebBase } from '../../shopLink.js';
import { isPaymentDetailFact, withoutPaymentDetails } from '../../paymentFacts.mjs';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = p => readFileSync(`${root}apps/web/src/${p}`, 'utf8');
const DAY = 86400000;

test('a lapsed "pro" column reads as Free, not pro', () => {
  const lapsed = { plan_tier: 'pro', subscription_plan: 'pro', subscription_status: 'active', subscription_expires_at: new Date(Date.now() - DAY).toISOString() };
  assert.equal(planLabel(lapsed), 'Free');
  const paid = { ...lapsed, subscription_expires_at: new Date(Date.now() + 10 * DAY).toISOString() };
  assert.equal(planLabel(paid), 'Pro');
  assert.match(planLabel({ subscription_status: 'trial', trial_ends_at: new Date(Date.now() + 3 * DAY).toISOString() }), /^Pro trial · 3 days left$/);
});

test('settings profile card uses planLabel, not the raw subscription_plan column', () => {
  const s = src('components/pages/SettingsPage.jsx');
  assert.match(s, /planLabel\(business\)/);
  assert.doesNotMatch(s, /business\?\.subscription_plan \|\| 'Free'/);
});

test('export: no .catch() on query builders, and Settings never links to the API route', () => {
  assert.doesNotMatch(src('app/api/businesses/export/route.js'), /\.catch\(\(\) => \(\{ data: \[\] \}\)\)/);
  assert.match(src('app/api/businesses/export/route.js'), /export async function POST/);
  assert.doesNotMatch(src('components/pages/SettingsPage.jsx'), /href: '\/api\//);
});

test('share link is never a vercel.app preview host', () => {
  assert.equal(brandedWebBase('https://web-theta-one-68.vercel.app'), null);
  assert.equal(customerShopLink({ shop_code: 'abc' }, 'https://web-theta-one-68.vercel.app'), 'https://t.me/MiniMeAgentBot?start=shop_abc');
  assert.equal(customerShopLink({ shop_code: 'abc' }, 'https://minime.et/'), 'https://minime.et/shop/abc');
  assert.equal(customerShopLink({ telegram_bot_username: 'IconnectBot', shop_code: 'abc' }), 'https://t.me/IconnectBot');
  assert.equal(customerShopLink({}), null);
});

test('payment proof without verify.et never activates Pro', () => {
  // The proof logic moved to subscriptionProof.js (shared with the in-chat upgrade).
  const s = src('lib/server/subscriptionProof.js');
  const fallback = s.slice(s.indexOf('Fallback: no verify.et configured'));
  assert.doesNotMatch(fallback, /subscription_status: 'active'/);
  assert.doesNotMatch(fallback, /Auto-activated/);
  assert.match(fallback, /subscription_status: 'pending_review'/);
});

test('approving a reviewed monthly payment grants a month, not a year', () => {
  assert.match(src('lib/server/replyEngine.js'), /const reviewed = PRO_PERIODS\[biz\.verifyet_plan\] \|\| PRO_PERIODS\.pro_annual;/);
});

test('admin-panel Approve grants the reviewed period, not a flat 30 days', () => {
  const s = src('app/api/admin/businesses/[id]/route.js');
  assert.match(s, /PRO_PERIODS\[cur\.verifyet_plan\] \|\| PRO_PERIODS\.pro_annual/);
  assert.match(s, /select\('subscription_expires_at, subscription_status, verifyet_plan'\)/);
});

test('Search Readiness listing link never hardcodes the vercel.app host', () => {
  assert.doesNotMatch(src('app/(dashboard)/settings/search/page.js'), /web-theta-one-68/);
});

test('payment numbers in learned facts are recognised', () => {
  assert.equal(isPaymentDetailFact('My Telebirr number is 0911 234 567'), true);
  assert.equal(isPaymentDetailFact('CBE account 1000123456789 (Selam)'), true);
  assert.equal(isPaymentDetailFact('ቴሌብር 0911234567'), true);
  assert.equal(isPaymentDetailFact('Prefers Telebirr over cash'), false);
  assert.equal(isPaymentDetailFact('Open Mon-Sat 8am-8pm'), false);
  assert.equal(isPaymentDetailFact('Max budget for branding around 30000 ETB'), false);
  assert.deepEqual(withoutPaymentDetails(['Sells coffee', 'Telebirr: 0911234567', 7]), ['Sells coffee']);
});

test('every prompt that reads owner_facts filters payment details', () => {
  assert.match(src('lib/server/replyEngine.js'), /withoutPaymentDetails\(business\?\.notification_prefs\?\.owner_facts\)/);
  assert.match(src('lib/server/ownerMemory.js'), /withoutPaymentDetails\(biz\?\.notification_prefs\?\.owner_facts\)/);
});
