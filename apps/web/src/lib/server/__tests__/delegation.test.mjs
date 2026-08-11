import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideDelegationAction, pickBestCandidate, nextOpenTimeMs, parseActiveHours, pickTaskByReply,
  stripMediaTags, FILE_SEND_METHOD, FILE_PAYLOAD_KEY, classifyTasklessMemberText,
  MAX_ACCEPT_PINGS, MAX_OVERDUE_CHASES, PREDUE_WINDOW_MS,
} from '../delegationLogic.mjs';

const NOW = Date.parse('2026-07-24T09:00:00Z'); // noon EAT (UTC+3)

// ────────────────────────────── decideDelegationAction ──────────────────────────────

test('blocked task with no escalation → escalate; once escalated → wait', () => {
  assert.equal(decideDelegationAction({ status: 'blocked' }, NOW).action, 'blocked_escalate');
  assert.equal(decideDelegationAction({ status: 'blocked', escalated_at: '2026-07-24T08:00:00Z' }, NOW).action, 'blocked_waiting');
});

test('non-live statuses are skipped', () => {
  for (const status of ['completed', 'cancelled', 'pending', 'failed']) {
    assert.equal(decideDelegationAction({ status }, NOW).action, 'skip');
  }
});

test('not accepted → pings up to the cap, then escalates', () => {
  assert.equal(decideDelegationAction({ status: 'in_progress', payload: { accept_pings: 0 } }, NOW).action, 'accept_ping');
  assert.equal(decideDelegationAction({ status: 'in_progress', payload: { accept_pings: MAX_ACCEPT_PINGS - 1 } }, NOW).action, 'accept_ping');
  assert.equal(decideDelegationAction({ status: 'in_progress', payload: { accept_pings: MAX_ACCEPT_PINGS } }, NOW).action, 'escalate_no_accept');
});

test('accepted + due within the pre-due window (not yet reminded) → pre-due reminder', () => {
  const due_at = new Date(NOW + 90 * 60000).toISOString(); // 90 min out (< 2h window)
  const t = { status: 'in_progress', accepted_at: '2026-07-24T08:00:00Z', due_at, payload: {} };
  assert.equal(decideDelegationAction(t, NOW).action, 'predue_reminder');
});

test('pre-due reminder fires only once', () => {
  const due_at = new Date(NOW + 90 * 60000).toISOString();
  const t = { status: 'in_progress', accepted_at: '2026-07-24T08:00:00Z', due_at, payload: { predue_sent: true } };
  // Already reminded and not yet due → sleep, not remind again.
  assert.equal(decideDelegationAction(t, NOW).action, 'sleep');
});

test('accepted + far from due → sleep', () => {
  const due_at = new Date(NOW + 10 * 3600000).toISOString(); // 10h out
  const t = { status: 'in_progress', accepted_at: '2026-07-24T08:00:00Z', due_at, payload: {} };
  assert.equal(decideDelegationAction(t, NOW).action, 'sleep');
});

test('overdue → chases up to the cap, then escalates once, then waits', () => {
  const due_at = new Date(NOW - 3600000).toISOString(); // 1h overdue
  const base = { status: 'in_progress', accepted_at: '2026-07-24T07:00:00Z', due_at };
  assert.equal(decideDelegationAction({ ...base, chase_count: 0, payload: {} }, NOW).action, 'overdue_chase');
  assert.equal(decideDelegationAction({ ...base, chase_count: MAX_OVERDUE_CHASES - 1, payload: {} }, NOW).action, 'overdue_chase');
  assert.equal(decideDelegationAction({ ...base, chase_count: MAX_OVERDUE_CHASES, payload: {} }, NOW).action, 'escalate_overdue');
  assert.equal(decideDelegationAction({ ...base, chase_count: MAX_OVERDUE_CHASES, escalated_at: '2026-07-24T08:30:00Z', payload: {} }, NOW).action, 'overdue_waiting');
});

test('a task with no due_at never becomes overdue — it sleeps once accepted', () => {
  const t = { status: 'in_progress', accepted_at: '2026-07-24T08:00:00Z', due_at: null, payload: {} };
  assert.equal(decideDelegationAction(t, NOW).action, 'sleep');
});

// ────────────────────────────── pickBestCandidate ──────────────────────────────

test('picks the least-loaded member under their cap', () => {
  const scored = [
    { s: { name: 'A' }, load: 3, cap: 5 },
    { s: { name: 'B' }, load: 1, cap: 5 },
    { s: { name: 'C' }, load: 4, cap: 5 },
  ];
  assert.equal(pickBestCandidate(scored).s.name, 'B');
});

test('skips members at or over their cap when someone else is free', () => {
  const scored = [
    { s: { name: 'A' }, load: 5, cap: 5 }, // capped
    { s: { name: 'B' }, load: 4, cap: 5 }, // free
  ];
  assert.equal(pickBestCandidate(scored).s.name, 'B');
});

test('when everyone is capped, still returns the least-loaded (never unassignable)', () => {
  const scored = [
    { s: { name: 'A' }, load: 7, cap: 5 },
    { s: { name: 'B' }, load: 6, cap: 5 },
  ];
  assert.equal(pickBestCandidate(scored).s.name, 'B');
});

test('empty candidate set → null', () => {
  assert.equal(pickBestCandidate([]), null);
  assert.equal(pickBestCandidate(null), null);
});

// ────────────────────────────── active-hours ──────────────────────────────

test('parseActiveHours accepts valid ranges, rejects junk', () => {
  assert.deepEqual(parseActiveHours('09:00-18:00'), { start: 9, end: 18 });
  assert.equal(parseActiveHours('18:00-09:00'), null); // start >= end
  assert.equal(parseActiveHours('nonsense'), null);
  assert.equal(parseActiveHours(''), null);
  assert.equal(parseActiveHours(null), null);
});

test('nextOpenTimeMs returns now when inside the window or when unset', () => {
  // NOW is noon EAT — inside 09:00-18:00.
  assert.equal(nextOpenTimeMs('09:00-18:00', NOW), NOW);
  assert.equal(nextOpenTimeMs(null, NOW), NOW);
});

test('nextOpenTimeMs defers to the next opening when outside the window', () => {
  // 22:00 UTC = 01:00 EAT (next day) — before a 09:00 open.
  const lateNight = Date.parse('2026-07-24T22:00:00Z');
  const opened = nextOpenTimeMs('09:00-18:00', lateNight);
  assert.ok(opened > lateNight, 'should defer forward');
  // Opening should be 09:00 EAT = 06:00 UTC.
  assert.equal(new Date(opened).getUTCHours(), 6);
});

test('nextOpenTimeMs after close rolls to the next day', () => {
  // 16:00 UTC = 19:00 EAT — after an 18:00 close.
  const evening = Date.parse('2026-07-24T16:00:00Z');
  const opened = nextOpenTimeMs('09:00-18:00', evening);
  assert.ok(opened > evening);
  const d = new Date(opened);
  assert.equal(d.getUTCHours(), 6); // 09:00 EAT next day
  assert.equal(d.getUTCDate(), 25);
});

// ────────────────────────────── pickTaskByReply ──────────────────────────────

test('pickTaskByReply matches the task whose assignee_message_id the reply answers', () => {
  const tasks = [
    { id: 'a', assignee_message_id: 111 },
    { id: 'b', assignee_message_id: 222 },
    { id: 'c', assignee_message_id: 333 },
  ];
  assert.equal(pickTaskByReply(tasks, 222).id, 'b');
});

test('pickTaskByReply picks the OLDER task, not the newest, when that is what the reply answers', () => {
  // Regression case for the bug this feature fixes: "done" used to always
  // close the most-recently-assigned task regardless of which brief it replied to.
  const tasks = [
    { id: 'newest', assigned_at: '2026-07-24T08:00:00Z', assignee_message_id: 999 },
    { id: 'older', assigned_at: '2026-07-23T08:00:00Z', assignee_message_id: 555 },
  ];
  assert.equal(pickTaskByReply(tasks, 555).id, 'older');
});

test('pickTaskByReply returns null with no reply context, so the caller falls back to most-recent', () => {
  const tasks = [{ id: 'a', assignee_message_id: 111 }];
  assert.equal(pickTaskByReply(tasks, undefined), null);
  assert.equal(pickTaskByReply(tasks, null), null);
});

test('pickTaskByReply returns null when the reply does not match any open task', () => {
  const tasks = [{ id: 'a', assignee_message_id: 111 }, { id: 'b', assignee_message_id: 222 }];
  assert.equal(pickTaskByReply(tasks, 999), null);
});

test('pickTaskByReply handles an empty task list', () => {
  assert.equal(pickTaskByReply([], 111), null);
  assert.equal(pickTaskByReply(null, 111), null);
});

test('pickTaskByReply compares numerically (string vs number message ids)', () => {
  const tasks = [{ id: 'a', assignee_message_id: '456' }];
  assert.equal(pickTaskByReply(tasks, 456).id, 'a');
  assert.equal(pickTaskByReply(tasks, '456').id, 'a');
});

// ────────────────────────────── stripMediaTags ──────────────────────────────

test('stripMediaTags strips the photo-analysis tag so a forwarded caption reads naturally', () => {
  const raw = '[photo analysis]\nWHAT: a laptop screen, cracked\nDETAILS: HP Pavilion';
  const out = stripMediaTags(raw);
  assert.ok(!out.includes('[photo analysis]'));
  assert.ok(out.includes('WHAT: a laptop screen'));
});

test('stripMediaTags strips the document tag', () => {
  const raw = '[document]\nInvoice #123, total 4500 ETB';
  assert.equal(stripMediaTags(raw), 'Invoice #123, total 4500 ETB');
});

test('stripMediaTags strips the voice-transcription tag and folds in a translation marker', () => {
  const raw = '[voice message transcription] ጨርሻለሁ [English translation] I finished it';
  const out = stripMediaTags(raw);
  assert.ok(!out.includes('[voice message transcription]'));
  assert.ok(out.includes('ጨርሻለሁ'));
  assert.ok(out.includes('(Translation: I finished it'));
});

test('stripMediaTags folds "Customer caption:" into a plain dash separator', () => {
  const raw = '[photo analysis]\nWHAT: shoes\n\nCustomer caption: are these in stock?';
  const out = stripMediaTags(raw);
  assert.ok(out.includes('— are these in stock?'));
  assert.ok(!out.toLowerCase().includes('customer caption'));
});

test('stripMediaTags returns null for empty/whitespace-only input', () => {
  assert.equal(stripMediaTags(null), null);
  assert.equal(stripMediaTags(''), null);
  assert.equal(stripMediaTags('   '), null);
});

test('stripMediaTags leaves ordinary text untouched', () => {
  assert.equal(stripMediaTags('just a normal message'), 'just a normal message');
});

// ────────────────────────────── file forwarding maps ──────────────────────────────

test('every stored telegram_file_type has a Telegram send method and payload key', () => {
  for (const type of ['photo', 'document', 'voice', 'video']) {
    assert.ok(FILE_SEND_METHOD[type], `missing send method for ${type}`);
    assert.ok(FILE_PAYLOAD_KEY[type], `missing payload key for ${type}`);
  }
});

test('an unrecognized file type has no mapping, so forwardTaskFiles skips it rather than guessing', () => {
  assert.equal(FILE_SEND_METHOD['sticker'], undefined);
  assert.equal(FILE_PAYLOAD_KEY['animation'], undefined);
});

// ────────────────────────────── classifyTasklessMemberText ──────────────────────────────
// The taskless-member router: a member with zero open tasks is now recognized
// instead of silently falling into the customer flow. This is the pure
// decision behind that — no LLM call, so it must be exact.

test('recognizes /mytasks and /help regardless of trailing text or @botname', () => {
  assert.equal(classifyTasklessMemberText('/mytasks'), 'mytasks');
  assert.equal(classifyTasklessMemberText('/mytasks please'), 'mytasks');
  assert.equal(classifyTasklessMemberText('/mytasks@MiniMeAgentBot'), 'mytasks');
  assert.equal(classifyTasklessMemberText('/help'), 'help');
  assert.equal(classifyTasklessMemberText('/help me'), 'help');
  assert.equal(classifyTasklessMemberText('/help@MiniMeAgentBot'), 'help');
});

test('commands are case-insensitive and tolerate surrounding whitespace', () => {
  assert.equal(classifyTasklessMemberText('  /MYTASKS  '), 'mytasks');
  assert.equal(classifyTasklessMemberText('/Help'), 'help');
});

test('a plain greeting with no open task is recognized, not dropped', () => {
  assert.equal(classifyTasklessMemberText('hi'), 'greeting');
  assert.equal(classifyTasklessMemberText('hello, what is this?'), 'greeting');
  assert.equal(classifyTasklessMemberText('good morning'), 'greeting');
});

test('customer-shaped text always wins, even wrapped in a greeting — the core regression guard', () => {
  assert.equal(classifyTasklessMemberText("hi, what's the price of the blue dress?"), 'customer_shaped');
  assert.equal(classifyTasklessMemberText('do you have this in stock'), 'customer_shaped');
  assert.equal(classifyTasklessMemberText('what is the price for 5 units'), 'customer_shaped');
  assert.equal(classifyTasklessMemberText('quote for delivery please'), 'customer_shaped');
});

test('empty or whitespace-only text is ignored, not treated as a greeting', () => {
  assert.equal(classifyTasklessMemberText(''), 'ignore');
  assert.equal(classifyTasklessMemberText('   '), 'ignore');
  assert.equal(classifyTasklessMemberText(null), 'ignore');
  assert.equal(classifyTasklessMemberText(undefined), 'ignore');
});
