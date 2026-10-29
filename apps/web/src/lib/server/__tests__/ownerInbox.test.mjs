import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyConversation, formatInbox, formatOrders, ownerHelpText } from '../ownerInbox.mjs';

const NOW = Date.parse('2026-10-28T19:30:00Z');
const at = mins => new Date(NOW - mins * 60000).toISOString();
const read = f => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

test('why a conversation needs the owner', () => {
  assert.equal(classifyConversation({ last_ai_action: 'send_failed', requires_owner: true }, null, NOW).reason, 'my reply didn’t reach them');
  assert.equal(classifyConversation({ last_ai_action: 'drafted', requires_owner: true }, null, NOW).reason, 'a draft is waiting for your OK');
  assert.equal(classifyConversation({ last_ai_action: 'asked_owner', requires_owner: true }, null, NOW).reason, 'I asked you a question about this');
  assert.equal(classifyConversation({ last_ai_action: 'auto_sent' }, { direction: 'inbound', created_at: at(30) }, NOW).reason, 'no reply yet');
  assert.equal(classifyConversation({ last_ai_action: 'auto_sent' }, { direction: 'inbound', created_at: at(2) }, NOW).needsYou, false, 'still within the reply window');
  assert.equal(classifyConversation({ last_ai_action: 'auto_sent' }, { direction: 'outbound', created_at: at(30) }, NOW).needsYou, false);
});

// Three people messaged; the owner asked who, and used to get /orders. Names are made up.
test('the inbox names who messaged and who is waiting', () => {
  const rows = [
    { conv: { last_message_at: at(4), last_ai_action: 'auto_sent', customers: { name: 'Abel' } }, last: { direction: 'outbound', created_at: at(4) } },
    { conv: { last_message_at: at(200), last_ai_action: 'send_failed', requires_owner: true, customers: { name: 'Sara' } }, last: { direction: 'inbound', content: 'how much is the metal card?', created_at: at(200) } },
    { conv: { last_message_at: at(210), last_ai_action: 'auto_sent', customers: { name: 'Liya' } }, last: { direction: 'outbound', created_at: at(210) } },
  ];
  const t = formatInbox(rows, { now: NOW, appUrl: 'https://app.example/' });
  assert.match(t, /3 people messaged today/);
  assert.match(t, /Waiting on you \(1\)/);
  assert.match(t, /Sara · my reply didn’t reach them · 3h ago — “how much is the metal card\?”/);
  assert.match(t, /Handled by MiniMe \(2\)\*\nAbel, Liya/);
  assert.match(t, /\[Open Chats →\]\(https:\/\/app\.example\/conversations\)/);
  assert.doesNotMatch(t, /step 0|draft ·|undefined/);
});

test('an empty inbox says so', () => {
  assert.equal(formatInbox([], { now: NOW }), '📭 *Nobody has messaged today.*');
});

// Shape of the real /orders output (names made up).
test('/orders groups orders, dedupes jobs and drops the jargon', () => {
  const job = (name, title, status) => ({ title, status, current_step: 0, customers: { name } });
  const t = formatOrders({
    orders: [
      { status: 'pending_payment', total: 3000, currency: 'ETB', customers: { name: 'Customer D' } },
      { status: 'paid', total: 4000, currency: 'ETB', customers: null },
    ],
    jobs: [
      job('Customer A', 'Branding package', 'active'),
      job('Customer A', 'Branding package', 'draft'),
      job('Customer A', 'Branding package', 'active'),
      job('Customer B', 'Logo design', 'draft'),
      job('Customer C', 'Custom card design', 'awaiting_approval'),
    ],
  }, { appUrl: 'https://app.example' });
  assert.match(t, /Waiting for payment \(1\)\*\n• Customer D — 3,000 ETB/);
  assert.match(t, /Paid, to deliver \(1\)\*\n• Customer — 4,000 ETB/);
  assert.match(t, /Customer jobs \(3\)/);
  assert.equal((t.match(/Customer A/g) || []).length, 1);
  assert.match(t, /Customer C — Custom card design · needs your OK/);
  assert.doesNotMatch(t, /step \d|unknown/);
});

test('/orders caps long job lists', () => {
  const jobs = Array.from({ length: 12 }, (_, i) => ({ title: `Job ${i}`, status: 'active', customers: { name: `C${i}` } }));
  const t = formatOrders({ jobs }, { maxJobs: 8 });
  assert.match(t, /…and 4 more/);
});

test('owner /help lists real capabilities', () => {
  const t = ownerHelpText('Philipos');
  assert.match(t, /Hi Philipos!/);
  assert.match(t, /Who messaged me today\?/);
  assert.match(t, /\/preview/);
});

test('owner /help, /inbox and the inbox tool are wired up', () => {
  const engine = read('../replyEngine.js');
  assert.ok(engine.includes("ownerHelpText("), 'owner /help handler');
  assert.ok(engine.includes("data === 'owner_inbox'"), 'button handler');
  assert.match(engine, /STAFF_SAFE_COMMANDS = \['\/help', '\/inbox'/);
  const cmds = read('../ownerCommands.js');
  assert.ok(cmds.includes("name: 'inbox_status'"), 'owner agent tool');
  assert.ok(cmds.includes("c.function.name === 'inbox_status'"), 'tool dispatch');
});
