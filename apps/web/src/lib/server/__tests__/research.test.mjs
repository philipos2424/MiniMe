/**
 * Research Agent partner resolution (resolvePartnerReference).
 *
 * Regression: past-partner candidates ("find me my usual supplier") were
 * filtered down to businesses with a dedicated bot token, so a partner on
 * the shared @MiniMeAgentBot (shop_code tenant, no telegram_bot_token_enc)
 * could never be recontacted through research even after real deal history.
 *
 * research.js can't be imported here (extensionless specifiers only the Next
 * bundler resolves), so this asserts against the source the way the other
 * DB-touching modules' tests do (see sendNudge.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = readFileSync(`${root}apps/web/src/lib/server/research.js`, 'utf8');

test('resolvePartnerReference selects the columns needed to resolve a shared-bot fallback token', () => {
  for (const col of ['owner_private_chat_id', 'telegram_bot_token_enc', 'shop_code', 'onboarding_completed']) {
    assert.match(src, new RegExp(col), `select() is missing "${col}"`);
  }
});

test('a past partner qualifies with their own bot OR the shared bot (shop_code + onboarding_completed)', () => {
  assert.match(src, /p\.telegram_bot_token_enc \|\| \(p\.shop_code && p\.onboarding_completed\)/);
});

// Regression: deliverReport and sendInterimReport raw-decrypted
// telegram_bot_token_enc and silently returned when it was null — since 868
// of 887 registered businesses (98%) have no dedicated bot and rely on the
// shared @MiniMeAgentBot, the research report was being built correctly and
// then almost never delivered. resolveToken() falls back to the shared bot;
// a raw decrypt() does not.
test('report delivery resolves a token via resolveToken, never a raw decrypt of telegram_bot_token_enc', () => {
  assert.match(src, /import \{ resolveToken \} from '\.\/sendAs';/);
  assert.doesNotMatch(src, /\bdecrypt\(/);
  const resolveCalls = src.match(/resolveToken\(biz, \{ as: 'bot' \}\)/g) || [];
  // deliverReport (final report) and sendInterimReport (50% progress DM).
  assert.ok(resolveCalls.length >= 2, `expected resolveToken at both delivery sites, found ${resolveCalls.length}`);
});

// Regression: three byte-identical "branding agency under 50k ETB" campaigns
// were launched for the same business on the same day — each one
// re-messaging the same real businesses with the same text.
test('startCampaign refuses a duplicate of an open campaign for the same business within 24h', () => {
  assert.match(src, /duplicate_campaign/);
  assert.match(src, /gte\('created_at', new Date\(Date\.now\(\) - 24 \* 60 \* 60 \* 1000\)\.toISOString\(\)\)/);
});

// Regression: one shared inquiry text was sent unchanged to every candidate
// (byte-identical messages, no personalization) — the lowest-effort possible
// outreach. Personalization must come from a REAL catalog match, never a
// guess, and must be omitted (not invented) when nothing matches.
// Harvested from apps/bot's Synergy Engine before that orphaned code was
// deleted — "who should I sell to" inverts normal category search using the
// SEARCHER's own category, not the (often signal-less) query text.
test('a "who would benefit" query routes through the harvested synergy discovery mode', () => {
  assert.match(src, /const \{ isSynergyQuery, synergyCategoriesFor \} = await import\('\.\/synergy\.mjs'\);/);
  assert.match(src, /if \(isSynergyQuery\(query\)\) \{/);
  assert.match(src, /const myCategory = business\.category_canonical \|\| business\.category;/);
});

test('outreach personalizes per recipient from a real, word-matched catalog item, and is fetched once per campaign not per send', () => {
  assert.match(src, /async function fetchRelevantProducts/);
  assert.match(src, /wordMatch\(t, kw\)/);
  assert.match(src, /const relevantProducts = await fetchRelevantProducts\(candidates\.map\(c => c\.id\), query\);/);
  assert.match(src, /const inquiryText = formatInquiryMessage\(\{/); // built inside the per-target loop
});
