import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  nudgeContent, pickNudgeType, isCooledDown, legacyMarkdownOk, plainText, shareUrl,
  DAY_MS, MAX_PER_TYPE,
} from '../ownerNudges.mjs';

// Worst case: shared-bot shop (link has "shop_"), markup characters in every
// free-text field an owner or searcher controls.
const SHOP = {
  name: 'Abel_Shop *Best*', owner_name: 'Ti_go Bekele', shop_code: 'abc1',
  trial_ends_at: new Date(Date.now() + 5 * DAY_MS).toISOString(),
  _incomplete: { missingPrice: 1, missingPhoto: 1, examples: ['Nike_Air', 'Mug *XL*'] },
  _demand: { top: { name: 'Red_Dress', views: 4, clicks: 1 }, opportunities: [{ query: 'iphone_13 *pro*', searches: 2 }] },
  _stats: { ai_messages_week: 5, customers_week: 2 },
};
const TYPES = ['never_taught', 'no_products', 'inactive_14d', 'no_first_customer', 'incomplete_catalog', 'demand_weekly', 'trial_ending_5d'];

test('every nudge type is valid Telegram legacy Markdown, even with markup in names', () => {
  for (const type of TYPES) {
    const c = nudgeContent(type, SHOP);
    assert.ok(c?.text, type);
    assert.ok(legacyMarkdownOk(c.text), `${type} would be rejected: ${c.text}`);
  }
});

test('the shared-bot link that broke delivery now parses, and the old text did not', () => {
  const link = 'https://t.me/MiniMeAgentBot?start=shop_abc1'; // real codes have no '_'
  assert.equal(legacyMarkdownOk(`Post this:\n\n${link}\n\n_italic hint_`), false); // the 2026-10-17 bug
  const c = nudgeContent('no_first_customer', SHOP);
  assert.ok(c.text.includes('start=shop\\_abc1'));
  assert.ok(legacyMarkdownOk(c.text));
});

test('first-customer nudge carries a one-tap share button with link and raw caption', () => {
  const c = nudgeContent('no_first_customer', SHOP);
  const btn = c.buttons[0][0];
  assert.equal(btn.text, '📣 Share my shop');
  const u = new URL(btn.url);
  assert.equal(u.origin + u.pathname, 'https://t.me/share/url');
  assert.equal(u.searchParams.get('url'), 'https://t.me/MiniMeAgentBot?start=shop_abc1');
  assert.match(u.searchParams.get('text'), /Abel_Shop \*Best\*/); // unescaped: share text isn't Markdown
  const custom = nudgeContent('no_first_customer', { ...SHOP, telegram_bot_username: 'abel_bot' });
  assert.equal(new URL(custom.buttons[0][0].url).searchParams.get('url'), 'https://t.me/abel_bot');
});

test('first-customer nudge: day 1, again on day 4, not a third time', () => {
  const now = Date.now();
  const once = { last_sent_at: new Date(now - 3 * DAY_MS).toISOString(), sent: { no_first_customer: { count: 1, last_at: new Date(now - 3 * DAY_MS).toISOString() } } };
  assert.equal(isCooledDown(once, 'no_first_customer', now), true);
  assert.equal(isCooledDown({ ...once, sent: { no_first_customer: { count: 1, last_at: new Date(now - 2 * DAY_MS).toISOString() } } }, 'no_first_customer', now), false);
  const twice = { ...once, sent: { no_first_customer: { count: MAX_PER_TYPE.no_first_customer, last_at: new Date(now - 5 * DAY_MS).toISOString() } } };
  assert.equal(isCooledDown(twice, 'no_first_customer', now), false);
  // An unrelated nudge two days ago doesn't block it (global-cooldown exempt).
  assert.equal(isCooledDown({ last_sent_at: new Date(now - 2 * DAY_MS).toISOString(), sent: {} }, 'no_first_customer', now), true);
  assert.equal(isCooledDown({ last_sent_at: new Date(now - 2 * DAY_MS).toISOString(), sent: {} }, 'never_taught', now), false);
});

test('zero-customer shops in their first two weeks get the first-customer nudge first', () => {
  const base = { business: SHOP, productCount: 0, documentCount: 0, customerCount: 0, aiMessagesWeek: 0, daysSinceSignup: 1.2, daysSinceActive: 0, daysUntilTrialEnd: 20 };
  assert.equal(pickNudgeType(base), 'no_first_customer');
  assert.equal(pickNudgeType({ ...base, daysSinceSignup: 15 }), 'never_taught');
  assert.equal(pickNudgeType({ ...base, customerCount: 1, daysSinceSignup: 3 }), 'never_taught');
});

test('plain-text fallback keeps the words, drops the markup', () => {
  assert.equal(plainText('*Abel\\_Shop* _hi_ `x` start=shop\\_1'), 'Abel_Shop hi x start=shop_1');
  assert.equal(shareUrl('https://t.me/a', 'b c'), 'https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fa&text=b%20c');
});

test('cron falls back to plain text on a parse error and the waitlist escapes and checks delivery', () => {
  const read = p => readFileSync(new URL(`../../../app/api/cron/${p}/route.js`, import.meta.url), 'utf8');
  const nudges = read('owner-nudges');
  assert.match(nudges, /can't parse entities/);
  assert.match(nudges, /plainText\(content\.text\)/);
  const waitlist = read('notify-waitlist');
  assert.match(waitlist, /inBold\(b\.name\)/);
  assert.match(waitlist, /inItalic\(entry\.raw_query/);
  assert.match(waitlist, /escapeMd\(link\)/);
  assert.match(waitlist, /if \(!sent\?\.ok\)/);
});
