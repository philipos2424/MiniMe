/**
 * Every command the product tells an owner to type must actually be handled.
 *
 * The regression this exists for: maybeNudgeAfterSend() signed off with
 * "/upgrade — 1,999 ETB/month · cancel anytime" from the day it was written,
 * and nothing anywhere handled /upgrade. The single call-to-action in the whole
 * payment funnel was not a command — an owner who typed it fell through to the
 * owner brain, which would improvise something plausible about pricing and had
 * no way to start a checkout.
 *
 * That failure is invisible in review (the copy reads fine) and invisible in
 * production (nothing throws — the brain answers), so it is pinned here
 * generically rather than as a one-off assertion: scan owner-facing copy for
 * the commands it offers, and require a handler for each.
 *
 * replyEngine.js can't be imported here (extensionless specifiers only the Next
 * bundler resolves), so this asserts against the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const engine = readFileSync(`${root}apps/web/src/lib/server/replyEngine.js`, 'utf8');
const botLink = readFileSync(`${root}apps/web/src/app/api/bot/link/route.js`, 'utf8');

/**
 * Commands replyEngine handles. Two shapes are in use and both count:
 *   msg.text.startsWith('/mode')
 *   msg.text.match(/^\/price(@\S+)?\s+\S/)
 */
const handled = new Set([
  ...[...engine.matchAll(/startsWith\('(\/[a-z]+)'\)/g)].map(m => m[1]),
  ...[...engine.matchAll(/\/\^\\\/([a-z]+)/g)].map(m => '/' + m[1]),
]);

/**
 * Lines of owner-facing copy that offer a command — either a list
 * ("_Use /mode for details · /auto_", "Commands: /orders · /sales") or a line
 * opening with a command and an em dash, which is the nudge's shape:
 *   `/upgrade — ${PRO_PRICE_ETB} ETB/month · cancel anytime`
 */
const isOwnerCopy = line =>
  !line.trim().startsWith('//') &&
  (/(?:Use |· |Commands: )\/[a-z]{3,}/.test(line) || /`\/[a-z]{3,} —/.test(line));

const offered = new Set();
for (const line of engine.split('\n').filter(isOwnerCopy)) {
  // The slash must not follow a word character, or "ETB/month" parses as a
  // command. A backtick may precede it — that's a template literal opening.
  for (const m of line.matchAll(/(?:^|[^\w])(\/[a-z]{3,})/g)) offered.add(m[1]);
}

test('the scan actually sees the copy — guard against a vacuous pass', () => {
  // If a refactor moves owner copy somewhere this can't see, every assertion
  // below would pass by finding nothing. Pin the floor.
  assert.ok(offered.size >= 20,
    `only found ${offered.size} advertised commands — the scan has stopped working`);
  assert.ok(offered.has('/upgrade'),
    'the upgrade nudge should be visible to this scan');
});

test('every command advertised to an owner has a handler', () => {
  const missing = [...offered].filter(c => !handled.has(c)).sort();
  assert.deepEqual(missing, [],
    `advertised to owners but never handled: ${missing.join(', ')}`);
});

test('/upgrade is registered in both command menus so it is discoverable', () => {
  // An owner who never receives the nudge should still be able to find it.
  const amharic = botLink.slice(0, botLink.indexOf('export const runtime'));
  assert.match(amharic, /command: 'upgrade'/,
    'Amharic owner command list should offer /upgrade');
  assert.match(botLink.slice(amharic.length), /command: 'upgrade'/,
    'English owner command list should offer /upgrade');
});

test('/upgrade answers what the owner is on, rather than always selling', () => {
  const from = engine.indexOf("if (msg.text.startsWith('/upgrade'))");
  const body = engine.slice(from, engine.indexOf("startsWith('/status')", from));

  assert.match(body, /plan\.isPro && !plan\.onTrial/,
    'should branch on already-Pro before offering checkout');

  // A shop already paying that types /upgrade is asking a question, not
  // shopping. Answering with a checkout button reads as a product that does
  // not know its own customer.
  const proBranch = body.slice(0, body.indexOf('const lines'));
  assert.ok(!/reply_markup/.test(proBranch),
    'the already-Pro reply must not carry an upgrade button');
});

test('checkout opens on arrival instead of landing on a page to navigate', () => {
  // settings/billing opens the sheet when ?feature= is present; without it the
  // owner arrives on a page and has to find the button again.
  assert.match(engine, /settings\/billing\?feature=/,
    '/upgrade should deep-link straight into the checkout sheet');
});

test('billing stays owner-only — staff get the standard refusal', () => {
  const staffSafe = engine.match(/const STAFF_SAFE_COMMANDS = \[([\s\S]*?)\];/)[1];
  assert.ok(!staffSafe.includes("'/upgrade'"),
    "a staff member should not be routed into the owner's billing");
});
