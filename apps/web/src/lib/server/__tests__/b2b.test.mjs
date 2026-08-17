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

// Regression: every reply required free-typing with no indication of what to
// type; the one real reply captured in production was "▪️Yes ▪️Logo, business
// card, social media assets" — unparseable into a comparison row. Research
// inquiries now get action-specific buttons, and "Not a fit" needs no typing
// at all (mirrors the b2b:notfit handler added in replyEngine.js).
test('research-campaign inquiries get research-flavored one-tap buttons, including a genuinely no-typing "not a fit"', () => {
  assert.match(src, /isResearchInquiry = !isReply && !!row\.structured\?\.campaign_id/);
  assert.match(src, /💰 Send a quote/);
  assert.match(src, /❓ Ask a question/);
  assert.match(src, /b2b:notfit:\$\{row\.id\}:\$\{idem\}/);
});

// Regression: maybeAutoNegotiate was gated ONLY on the b2b_auto_negotiate
// boolean and never consulted trust level — a SHADOW-level owner could have
// deals closed autonomously. And recordDeal fired the instant the model
// said action:'accept', with no human anywhere in the path.
test('auto-negotiation is gated by canAutoNegotiate (trust + autonomy level), not the boolean alone', () => {
  assert.match(src, /const \{ canAutoNegotiate, canAutoCloseDeal \} = await import\('\.\/b2bAutonomy\.mjs'\);/);
  assert.match(src, /if \(!recipientBiz\.b2b_auto_negotiate \|\| !canAutoNegotiate\(recipientBiz\)\) return;/);
});

test('an AI-accepted deal only auto-closes within canAutoCloseDeal; otherwise it is proposed for owner approval', () => {
  assert.match(src, /if \(canAutoCloseDeal\(recipientBiz, offerData, 'sell'\)\) \{/);
  assert.match(src, /async function proposeDealForApproval/);
  // The approval DM offers a real Accept/Reject choice, not just a notice.
  assert.match(src, /b2b:dealok:\$\{incomingRow\.id\}:\$\{idem\}/);
  assert.match(src, /b2b:dealno:\$\{incomingRow\.id\}:\$\{idem\}/);
});

// Harvested from apps/bot's negotiation_engine.js ("deterministic: no LLM
// here, only hard rules") before that orphaned module was deleted — matches
// the 2026-08-02 spec's "deterministic core first" that the live path never
// implemented. A real price floor the owner set is arithmetic, not a model
// judgment call.
test('an incoming offer is checked against the owner price floor by arithmetic before any model call', () => {
  assert.match(src, /const \{ evaluateOfferDeterministic \} = await import\('\.\/negotiationRules\.mjs'\);/);
  assert.match(src, /direction: 'sell',/);
  assert.match(src, /: await runNegotiationResponse\(incomingRow, senderBiz, recipientBiz\);/);
});

test('every owner-DM send site resolves a token via resolveToken (own bot, falling back to the shared bot), not a raw decrypt of telegram_bot_token_enc', () => {
  assert.match(src, /import \{ resolveToken \} from '\.\/sendAs';/);
  assert.doesNotMatch(src, /decrypt\(/); // no more direct token decryption left in this file
  const resolveCalls = src.match(/resolveToken\([\w.]+, \{ as: 'bot' \}\)/g) || [];
  // deliverInboundToOwner, recordDecline's sender notify, auto-negotiate
  // summary, the deal-agreed loop, and the warm-intro requester notify.
  assert.ok(resolveCalls.length >= 5, `expected resolveToken used at every DM send site, found ${resolveCalls.length}`);
});

// ── Browse directory (2026-08) ──────────────────────────────────────────────

// Browse ran its own ilike OR and returned rows in whatever order Postgres
// produced them, while MiniMe Search ranked the same table properly one file
// over. The scoring is now shared; only liveness/proximity are B2B-specific.
test('browseNetwork ranks through the shared ranker instead of raw DB order', () => {
  assert.match(src, /import \{ orderBrowseResults, browseKeywords \} from '\.\/browseRank\.mjs';/);
  assert.match(src, /return orderBrowseResults\(rows, \{/);
  assert.doesNotMatch(src, /return \[\.\.\.byId\.values\(\)\]\.slice\(0, limit\);/,
    'the unranked return path must be gone');
});

// The card cannot show a trust or liveness signal the query never selected.
test('the browse select carries the trust and liveness columns', () => {
  const cols = src.match(/const BROWSE_COLS = `([\s\S]*?)`;/)[1];
  for (const col of ['verified', 'average_rating', 'total_reviews', 'last_active_date', 'onboarding_completed']) {
    assert.ok(cols.includes(col), `BROWSE_COLS must select ${col}`);
  }
});

// "They sell what you asked for, at this price" is the difference between a
// directory row and a reason to make contact — and the query already ran.
test('product matches are returned with the businesses, not discarded', () => {
  assert.match(src, /async function findMatchingProductsByBusiness/);
  assert.match(src, /_matched_products: matchedProducts\.get\(b\.id\) \|\| \[\]/);
});

// Every caller already branches on res.ok / res.error; the function never
// produced either, so a blocked intro was reported to the owner as delivered.
test('sendWarmIntro reports failure instead of always claiming success', () => {
  assert.match(src, /if \(!threadRes\.ok\) \{\s*\n\s*return \{ ok: false, error: threadRes\.error \|\| 'thread_not_created', \.\.\.results \};/);
});
