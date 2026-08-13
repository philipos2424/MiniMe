/**
 * Social proof honesty guarantees.
 *
 * These numbers sit directly above a payment button, so the failure mode isn't
 * a wrong pixel — it's a false claim to someone deciding whether to trust us
 * with money. Each test pins a property that keeps the claim TRUE.
 *
 * socialProof.js can't be imported here (it pulls in the service-role Supabase
 * client at module load), so these assert against the source text. That's blunt
 * but it catches the failures that actually matter: a hardcoded number, a
 * metric that drifts between the app and the bot, or a lost floor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const web = readFileSync(`${root}apps/web/src/lib/server/socialProof.js`, 'utf8');
const bot = readFileSync(`${root}packages/db/queries/businesses.js`, 'utf8');
const ui  = readFileSync(`${root}apps/web/src/components/ui/SocialProof.jsx`, 'utf8');
const api = readFileSync(`${root}apps/web/src/app/api/stats/social-proof/route.js`, 'utf8');

test('counts come from live queries, not from constants', () => {
  // The one thing that must never happen: a hardcoded signup count. If this
  // fails, someone has replaced evidence with a marketing number.
  assert.match(web, /from\('businesses'\)[\s\S]{0,120}count: 'exact'/);
  assert.match(web, /from\('messages'\)[\s\S]{0,200}count: 'exact'/);
  assert.match(bot, /from\('businesses'\)[\s\S]{0,120}count: 'exact'/);
});

test('the metric is every signup — not a filtered subset', () => {
  // The businesses count must carry no .eq() filter narrowing it; "signed up"
  // means signed up. A stray filter (onboarding_completed, plan_tier, …) would
  // quietly understate the headline number.
  for (const [name, src] of [['web', web], ['bot', bot]]) {
    const q = src.match(/from\('businesses'\)\.select\([^;]*?\);/);
    assert.ok(q, `${name} signup count query not found`);
    assert.ok(!/\.eq\(/.test(q[0]), `${name} signup count has been filtered: ${q[0]}`);
  }
});

test('app and bot report the SAME metric under the same name', () => {
  // Different numbers from the bot and the app in the same minute reads as
  // fabricated, which is worse than showing nothing.
  for (const [name, src] of [['web', web], ['bot', bot]]) {
    assert.match(src, /signups/, `${name} no longer exposes a signups figure`);
  }
});

test('both copies keep a floor below which nothing is shown', () => {
  // Weak proof is worse than silence; the floor enforces that.
  const webMin = web.match(/MIN_SIGNUPS\s*=\s*(\d+)/);
  const botMin = bot.match(/SOCIAL_PROOF_MIN_SIGNUPS\s*=\s*(\d+)/);
  assert.ok(webMin, 'web floor removed');
  assert.ok(botMin, 'bot floor removed');
  assert.equal(webMin[1], botMin[1], 'web and bot floors diverged');

  const webRep = web.match(/MIN_REPLIES\s*=\s*(\d+)/);
  const botRep = bot.match(/SOCIAL_PROOF_MIN_REPLIES\s*=\s*(\d+)/);
  assert.equal(webRep[1], botRep[1], 'web and bot reply floors diverged');
});

test('below the floor the payload is null, so the UI renders nothing', () => {
  assert.match(web, /signups < MIN_SIGNUPS\) return null/);
  assert.match(bot, /signups < SOCIAL_PROOF_MIN_SIGNUPS\) return null/);
  // And the component must actually honour that rather than render a zero.
  assert.match(ui, /if \(!proof\) return null/);
  assert.match(ui, /proof\?\.signups \? proof : null/);
});

test('the count is exact — no rounding left anywhere in the path', () => {
  // An earlier version rounded down so an "N+" claim could never overstate.
  // A live count must tick, and exact can't overstate either, so rounding is
  // gone. If it comes back, the "+" suffix has to come back with it.
  for (const [name, src] of [['web', web], ['bot', bot], ['ui', ui]]) {
    assert.ok(!/roundDown/i.test(src), `${name} still rounds the count`);
  }
  assert.ok(!/\+<\/strong>|\}\+/.test(ui), 'UI still renders a "+" suffix on an exact count');
});

test('nothing in the path can serve a stale signup number as live', () => {
  // A CDN copy or an ISR snapshot would freeze the count.
  assert.match(api, /dynamic\s*=\s*'force-dynamic'/);
  assert.match(api, /revalidate\s*=\s*0/);
  assert.match(api, /no-store/);
  assert.match(ui, /cache: 'no-store'/);
  // The server-side window exists only to collapse bursts; keep it small.
  const ttl = Number(web.match(/SIGNUPS_TTL_MS\s*=\s*(\d+)\s*\*\s*1000/)[1]);
  assert.ok(ttl <= 60, `signup cache window ${ttl}s is too long to call this live`);
});

test('the expensive reply count is NOT on the live clock', () => {
  // `messages` is the biggest table in the system; counting it every 15s would
  // put a scan in front of every paywall render. Migration 036 adds a partial
  // index, but the count still has to stay off the hot path.
  const signupsTtl = Number(web.match(/SIGNUPS_TTL_MS\s*=\s*(\d+)\s*\*\s*1000/)[1]);
  const repliesTtl = Number(web.match(/REPLIES_TTL_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/)[1]) * 60;
  assert.ok(repliesTtl > signupsTtl * 10, 'reply count is being refreshed too aggressively');

  // Same split in the bot copy, or the cron pass pays the cost instead.
  assert.match(bot, /SOCIAL_PROOF_SIGNUPS_TTL_MS/);
  assert.match(bot, /SOCIAL_PROOF_REPLIES_TTL_MS/);
});

test('a slow or failed reply count never takes the signup number down with it', () => {
  // The headline figure is the one that matters; it must survive alone.
  assert.match(web, /const signups = signupsCache\?\.value \?\? 0/);
  assert.match(web, /replies: replies >= MIN_REPLIES \? replies : null/);
});

// ── Peer proof ("shops like yours, near you") ────────────────────────────────

test('the peer ladder falls back rather than printing an embarrassing number', () => {
  // "1 cosmetics shop in Addis uses MiniMe" is anti-proof. The floor is what
  // makes it fall back to the city, then to the national figure.
  assert.match(web, /MIN_PEERS\s*=\s*(\d+)/);
  const min = Number(web.match(/MIN_PEERS\s*=\s*(\d+)/)[1]);
  assert.ok(min >= 2, 'a peer count of 1 would reach the paywall');

  // Both rungs gated by the same floor, and null when neither clears it.
  assert.match(web, /n >= MIN_PEERS\) return \{ count: n, scope: 'category_city'/);
  assert.match(web, /n >= MIN_PEERS\) return \{ count: n, scope: 'city'/);
  assert.match(web, /return null;\s*\n\s*\} catch/);
});

test('peer inputs are sanitised before reaching a PostgREST filter', () => {
  // category/city arrive from a query string; %,()* are filter syntax there.
  assert.match(web, /function clean\(s\)[\s\S]{0,200}replace\(\/\[%,\(\)\*\]\/g/);
  assert.match(web, /\.slice\(0, 60\)/);
});

test('the peer cache cannot grow without bound', () => {
  // Keyed by arbitrary caller-supplied category/city, so it needs a ceiling.
  assert.match(web, /peersCache\.size > \d+\) peersCache\.clear\(\)/);
});

test('the UI never claims peers are on Pro — only that they use MiniMe', () => {
  // The count is of shops USING MiniMe. Implying they all pay would be false.
  assert.ok(!/on Pro/i.test(ui), 'UI overclaims what the peer count measures');
  assert.match(ui, /use it/);
});

test('the reply-count query matches the partial index predicate', () => {
  // If the query and migration 036's WHERE clause drift apart, the index stops
  // being usable and the count silently goes back to a sequential scan.
  const migration = readFileSync(
    `${root}packages/db/migrations/036_social_proof_reply_count_index.sql`, 'utf8',
  );
  assert.match(migration, /is_ai_generated = true AND direction = 'outbound'/);
  assert.match(web, /\.eq\('is_ai_generated', true\)\.eq\('direction', 'outbound'\)/);
  assert.match(bot, /\.eq\('is_ai_generated', true\)\.eq\('direction', 'outbound'\)/);
  // CONCURRENTLY matters: without it the build locks writes to `messages`.
  assert.match(migration, /CREATE INDEX CONCURRENTLY/);
});

test('the badge refreshes itself while it is on screen', () => {
  const poll = Number(ui.match(/POLL_MS\s*=\s*(\d+)/)[1]);
  assert.ok(poll >= 5000, 'polling faster than 5s would hammer the DB for no gain');
  assert.ok(poll <= 60000, 'polling slower than 60s is not meaningfully live');
  assert.match(ui, /setTimeout\(load, POLL_MS\)/);
});

test('a failed count keeps the last good number instead of dropping the badge', () => {
  // Each count is fetched in its own try/catch that does NOT overwrite the
  // cache on failure, so a transient DB error mid-session leaves the badge
  // showing the previous real figure rather than vanishing.
  // Independent try/catch per count, so a failure in the expensive one can't
  // take the headline figure with it. (>= 2: the peer lookup adds its own.)
  assert.ok((web.match(/catch \(e\) \{/g) || []).length >= 2, 'counts share a catch block');
  assert.ok((bot.match(/catch \(e\) \{/g) || []).length >= 2, 'counts share a catch block');

  // A cache is only ever written with a freshly fetched count on the SUCCESS
  // path. If an assignment of a real count appears inside a catch, a transient
  // error would overwrite good data with a wrong number.
  for (const [name, src] of [['web', web], ['bot', bot]]) {
    const inCatch = src.split(/catch \(e\) \{/).slice(1).map(s => s.split('\n    }')[0]);
    for (const block of inCatch) {
      assert.ok(!/value: Number\(count\)/.test(block), `${name}: a catch block writes a fetched count`);
    }
  }
  // Reads go through the caches, never through a value computed in the catch.
  assert.match(web, /signupsCache\?\.value \?\? 0/);
  assert.match(bot, /_signupsCache\?\.value \?\? 0/);
});
