/**
 * The shared agent-bot webhook must skip updates Telegram re-delivers, or a
 * slow reply gets sent twice in the owner's name. It can only be given the
 * same 300s budget as the shop-bot because of that. Source-text test: the
 * route can't be imported outside the Next bundler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const route = readFileSync(new URL('../../../app/api/agent-bot/webhook/route.js', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('../../../../../../packages/db/migrations/063_agent_bot_update_dedupe.sql', import.meta.url), 'utf8');

test('agent-bot dedupes on update_id before doing any work', () => {
  const post = route.slice(route.indexOf('export async function POST('));
  const dedupe = post.indexOf("from('agent_bot_update_dedupe')");
  assert.ok(dedupe > 0, 'dedupe insert present');
  assert.ok(dedupe > post.indexOf('timingSafeEqual'), 'runs after the secret check');
  assert.ok(dedupe < post.indexOf('ensureSharedWebhook()'), 'runs before any handling');
  assert.match(post.slice(dedupe, dedupe + 400), /23505[\s\S]*deduped: true/);
});

test('agent-bot route and vercel.json agree on the time budget', () => {
  const routeMax = Number(route.match(/export const maxDuration = (\d+)/)?.[1]);
  assert.equal(routeMax, 300);
  assert.equal(vercel.functions['src/app/api/agent-bot/**'].maxDuration, routeMax);
});

test('migration 063 rejects a repeated update_id and keeps the table server-only', async () => {
  const db = new PGlite();
  await db.exec(migration);
  await db.query('insert into agent_bot_update_dedupe (update_id) values (1)');
  await assert.rejects(db.query('insert into agent_bot_update_dedupe (update_id) values (1)'), e => e.code === '23505');
  const { rows } = await db.query("select relrowsecurity from pg_class where relname='agent_bot_update_dedupe'");
  assert.equal(rows[0].relrowsecurity, true);
});
