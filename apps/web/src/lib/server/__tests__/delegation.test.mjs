import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideDelegationAction, pickBestCandidate, nextOpenTimeMs, parseActiveHours, pickTaskByReply,
  stripMediaTags, FILE_SEND_METHOD, FILE_PAYLOAD_KEY, classifyTasklessMemberText,
  MAX_ACCEPT_PINGS, MAX_OVERDUE_CHASES, PREDUE_WINDOW_MS,
  teamGroupTaskButtons, bucketStandupTasks, memberReliability, needsChasing,
} from '../delegationLogic.mjs';

const NOW = Date.parse('2026-07-24T09:00:00Z'); // noon EAT (UTC+3)
const HOUR = 3600000;

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

// ────────────────────────────── teamGroupTaskButtons ──────────────────────────────

const flat = (kb) => (kb?.inline_keyboard || []).flat().map(b => b.callback_data);

test('a fresh assignment offers accept, done and blocked', () => {
  const kb = teamGroupTaskButtons({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', supplier_id: 's1', status: 'in_progress' });
  assert.deepEqual(flat(kb), [
    'dtask_accept_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'dtask_done_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'dtask_blocked_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  ]);
});

test('once accepted, the accept button is gone but done/blocked remain', () => {
  const kb = teamGroupTaskButtons({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', supplier_id: 's1', status: 'in_progress', accepted_at: '2026-07-24T09:00:00Z' });
  assert.deepEqual(flat(kb), [
    'dtask_done_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'dtask_blocked_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  ]);
});

test('an already-blocked task does not offer Blocked again', () => {
  const kb = teamGroupTaskButtons({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', supplier_id: 's1', status: 'blocked', accepted_at: '2026-07-24T09:00:00Z' });
  assert.deepEqual(flat(kb), ['dtask_done_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
});

test('terminal statuses get no buttons at all — the caller clears the markup', () => {
  for (const status of ['completed', 'cancelled', 'failed']) {
    assert.equal(teamGroupTaskButtons({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', supplier_id: 's1', status }), null);
  }
});

test('a task with no id yields no buttons (nothing to address the callback to)', () => {
  assert.equal(teamGroupTaskButtons({ status: 'in_progress', supplier_id: 's1' }), null);
  assert.equal(teamGroupTaskButtons(null), null);
});

test('an unassigned task gets no buttons — nobody would be authorised to tap them', () => {
  assert.equal(teamGroupTaskButtons({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'pending' }), null);
});

// ────────────────────────────── bucketStandupTasks ──────────────────────────────

const T = (over) => ({ title: 't', status: 'in_progress', ...over });

test('buckets are mutually exclusive — a blocked task that is also overdue counts as blocked only', () => {
  const b = bucketStandupTasks([
    T({ title: 'stuck', status: 'blocked', due_at: new Date(NOW - HOUR).toISOString() }),
  ], NOW);
  assert.deepEqual(b.blocked.map(t => t.title), ['stuck']);
  assert.equal(b.overdue.length, 0);
  assert.equal(b.inProgress.length, 0);
});

test('assigned long ago and never accepted → silent, not in progress', () => {
  const b = bucketStandupTasks([
    T({ title: 'no reply', assigned_at: new Date(NOW - 5 * HOUR).toISOString() }),
  ], NOW);
  assert.deepEqual(b.silent.map(t => t.title), ['no reply']);
  assert.equal(b.inProgress.length, 0);
});

test('assigned within the acceptance grace period is still just in progress', () => {
  const b = bucketStandupTasks([
    T({ title: 'just sent', assigned_at: new Date(NOW - 5 * 60_000).toISOString() }),
  ], NOW);
  assert.deepEqual(b.inProgress.map(t => t.title), ['just sent']);
  assert.equal(b.silent.length, 0);
});

test('accepted work is never silent, however long ago it was assigned', () => {
  const b = bucketStandupTasks([
    T({ title: 'working', assigned_at: new Date(NOW - 48 * HOUR).toISOString(), accepted_at: new Date(NOW - 47 * HOUR).toISOString() }),
  ], NOW);
  assert.deepEqual(b.inProgress.map(t => t.title), ['working']);
  assert.equal(b.silent.length, 0);
});

test('overdue outranks silent — a missed deadline is the more urgent fact', () => {
  const b = bucketStandupTasks([
    T({ title: 'late', assigned_at: new Date(NOW - 48 * HOUR).toISOString(), due_at: new Date(NOW - HOUR).toISOString() }),
  ], NOW);
  assert.deepEqual(b.overdue.map(t => t.title), ['late']);
  assert.equal(b.silent.length, 0);
});

test('a pending (unassigned) task past its due date still shows as overdue', () => {
  const b = bucketStandupTasks([
    T({ title: 'nobody took it', status: 'pending', due_at: new Date(NOW - HOUR).toISOString() }),
  ], NOW);
  assert.deepEqual(b.overdue.map(t => t.title), ['nobody took it']);
});

test('an unassigned pending task with no deadline lands in no bucket — nothing to report', () => {
  const b = bucketStandupTasks([T({ title: 'someday', status: 'pending' })], NOW);
  assert.deepEqual([b.blocked, b.overdue, b.silent, b.inProgress].map(x => x.length), [0, 0, 0, 0]);
});

test('empty and nullish input are safe', () => {
  for (const input of [[], null, undefined]) {
    const b = bucketStandupTasks(input, NOW);
    assert.deepEqual([b.blocked, b.overdue, b.silent, b.inProgress].map(x => x.length), [0, 0, 0, 0]);
  }
});

// -------------------------------- memberReliability --------------------------------

const MIN = 60000;

test('folds tasks and events into per-member counts', () => {
  const tasks = [
    { id: 't1', supplier_id: 's1', status: 'completed', due_at: new Date(NOW).toISOString(), completed_at: new Date(NOW - MIN).toISOString() },
    { id: 't2', supplier_id: 's1', status: 'completed', due_at: new Date(NOW).toISOString(), completed_at: new Date(NOW + MIN).toISOString() },
    { id: 't3', supplier_id: 's2', status: 'in_progress' },
  ];
  const events = [
    { task_id: 't1', action: 'chased' }, { task_id: 't1', action: 'chased' },
    { task_id: 't2', action: 'escalated' },
    { task_id: 't3', action: 'chased' },
  ];
  const r = memberReliability(tasks, events);
  assert.equal(r.get('s1').assigned, 2);
  assert.equal(r.get('s1').completed, 2);
  assert.equal(r.get('s1').onTime, 1);          // t2 landed a minute late
  assert.equal(r.get('s1').onTimeRate, 50);
  assert.equal(r.get('s1').chases, 2);
  assert.equal(r.get('s1').escalations, 1);
  assert.equal(r.get('s2').assigned, 1);
  assert.equal(r.get('s2').chases, 1);
  assert.equal(r.get('s1').open, 0);
  assert.equal(r.get('s2').open, 1);
});

test('open counts live work only — blocked is still on their plate, cancelled is not', () => {
  const r = memberReliability([
    { id: 'a', supplier_id: 's1', status: 'blocked' },
    { id: 'b', supplier_id: 's1', status: 'pending' },
    { id: 'c', supplier_id: 's1', status: 'cancelled' },
    { id: 'd', supplier_id: 's1', status: 'completed' },
  ], []);
  assert.equal(r.get('s1').open, 2);
  assert.equal(r.get('s1').assigned, 4);
});

test('acceptance latency averages assigned_at -> accepted_at, in minutes', () => {
  const r = memberReliability([
    { id: 't1', supplier_id: 's1', status: 'in_progress', assigned_at: new Date(NOW).toISOString(), accepted_at: new Date(NOW + 10 * MIN).toISOString() },
    { id: 't2', supplier_id: 's1', status: 'in_progress', assigned_at: new Date(NOW).toISOString(), accepted_at: new Date(NOW + 20 * MIN).toISOString() },
  ], []);
  assert.equal(r.get('s1').avgAcceptMins, 15);
});

test('a task never accepted contributes no latency sample rather than a zero', () => {
  const r = memberReliability([
    { id: 't1', supplier_id: 's1', status: 'in_progress', assigned_at: new Date(NOW).toISOString() },
  ], []);
  assert.equal(r.get('s1').avgAcceptMins, null);
  assert.equal(r.get('s1').assigned, 1);
});

test('completed work with no deadline leaves the on-time rate unknown, not 0%', () => {
  const r = memberReliability([
    { id: 't1', supplier_id: 's1', status: 'completed', completed_at: new Date(NOW).toISOString() },
  ], []);
  assert.equal(r.get('s1').completed, 1);
  assert.equal(r.get('s1').withDue, 0);
  assert.equal(r.get('s1').onTimeRate, null);
});

test('events for unassigned or unknown tasks are attributed to nobody', () => {
  const r = memberReliability(
    [{ id: 't1', supplier_id: null, status: 'pending' }],
    [{ task_id: 't1', action: 'chased' }, { task_id: 'ghost', action: 'chased' }],
  );
  assert.equal(r.size, 0);
});

test('empty and nullish input are safe', () => {
  assert.equal(memberReliability([], []).size, 0);
  assert.equal(memberReliability(null, null).size, 0);
});

// -------------------------------- needsChasing --------------------------------

test('sums chases per member and ranks the worst first', () => {
  const out = needsChasing([
    { supplier_name: 'Dawit', chase_count: 3 },
    { supplier_name: 'Meron', chase_count: 2 },
    { supplier_name: 'Dawit', chase_count: 1 },
  ]);
  assert.deepEqual(out, [{ name: 'Dawit', chases: 4 }, { name: 'Meron', chases: 2 }]);
});

test('members under the threshold are left out entirely — no nudge, no line', () => {
  assert.deepEqual(needsChasing([{ supplier_name: 'Dawit', chase_count: 1 }]), []);
});

test('tasks with no assignee or no chases never appear', () => {
  assert.deepEqual(needsChasing([
    { supplier_name: null, chase_count: 9 },
    { supplier_name: 'Meron', chase_count: 0 },
  ]), []);
  assert.deepEqual(needsChasing([]), []);
  assert.deepEqual(needsChasing(null), []);
});
