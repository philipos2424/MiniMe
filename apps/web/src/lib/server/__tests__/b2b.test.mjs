/**
 * Research Agent candidate search (searchBusinessesByCategory).
 *
 * Regression: "compare laptops" reported zero matches even though a
 * registered business had "laptops" in its product catalog, because the
 * search only ever queried `businesses.name/description/category/tags` and
 * never the `products` table where catalog items actually live.
 *
 * b2b.js can't be imported here (extensionless specifiers only the Next
 * bundler resolves), so this asserts against the source the way the other
 * DB-touching modules' tests do (see sendNudge.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = readFileSync(`${root}apps/web/src/lib/server/b2b.js`, 'utf8');

test('searchBusinessesByCategory also searches the products catalog, not just the business profile', () => {
  assert.match(src, /from\('products'\)/);
  assert.match(src, /findBusinessIdsByProductMatch/);
});

test('product matches are validated with word-boundary matching, not raw substring', () => {
  assert.match(src, /import \{ singularize, wordMatch \} from '\.\/searchRanker\.mjs';/);
  assert.match(src, /wordMatch\(t, kw\)/);
});

test('product-matched businesses still require the b2b reachability filters', () => {
  const fn = src.match(/async function findBusinessIdsByProductMatch[\s\S]*?\n\}/)[0];
  // The hydration query for product-only matches must still go through
  // runQuery(), which enforces b2b_discoverable + B2B_REACHABLE_FILTER —
  // sendBusinessMessage can't reach a business it has no token/chat for.
  assert.doesNotMatch(fn, /b2b_discoverable/); // filter lives in runQuery, not here
  assert.match(src, /runQuery\(true, `id\.in\.\(\$\{missing\.join\(','\)\}\)`\)/);
});

// ── Regression: businesses on the shared @MiniMeAgentBot (shop_code /
// Secretary-Mode tenants, no dedicated bot token) were entirely invisible to
// B2B/Research outreach — every reachability filter required
// telegram_bot_token_enc IS NOT NULL, and every send site decrypted that
// column directly instead of falling back to the shared bot.
test('reachability filter admits shop_code tenants, not just businesses with their own bot', () => {
  assert.match(src, /const B2B_REACHABLE_FILTER = 'telegram_bot_token_enc\.not\.is\.null,and\(shop_code\.not\.is\.null,onboarding_completed\.eq\.true\)';/);
  // browseNetwork and searchBusinessesByCategory's runQuery both use it
  // instead of a token-only .not(...) filter.
  assert.doesNotMatch(src, /\.not\('telegram_bot_token_enc', 'is', null\)/);
  const orCalls = src.match(/\.or\(B2B_REACHABLE_FILTER\)/g) || [];
  assert.ok(orCalls.length >= 2, `expected the reachability filter applied in both browseNetwork and searchBusinessesByCategory, found ${orCalls.length} use(s)`);
});

test('every owner-DM send site resolves a token via resolveToken (own bot, falling back to the shared bot), not a raw decrypt of telegram_bot_token_enc', () => {
  assert.match(src, /import \{ resolveToken \} from '\.\/sendAs';/);
  assert.doesNotMatch(src, /decrypt\(/); // no more direct token decryption left in this file
  const resolveCalls = src.match(/resolveToken\([\w.]+, \{ as: 'bot' \}\)/g) || [];
  // deliverInboundToOwner, recordDecline's sender notify, auto-negotiate
  // summary, the deal-agreed loop, and the warm-intro requester notify.
  assert.ok(resolveCalls.length >= 5, `expected resolveToken used at every DM send site, found ${resolveCalls.length}`);
});
