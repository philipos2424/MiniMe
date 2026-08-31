import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  memberProfile, reliabilityScore, decideDelegationAction,
  DEFAULT_POLICY, MIN_PROFILE_SAMPLES, ACCEPT_WAIT_MIN_MS, ACCEPT_WAIT_MAX_MS,
  MAX_ACCEPT_PINGS, MAX_OVERDUE_CHASES, ACCEPT_WAIT_MS, PREDUE_WINDOW_MS,
} from '../delegationLogic.mjs';

const NOW = Date.parse('2026-07-24T09:00:00Z');
const MIN = 60000;

// A member row shaped like one memberReliability() entry.
const row = (o = {}) => ({
  assigned: 10, open: 1, completed: 8, onTime: 8, withDue: 8,
  chases: 0, escalations: 0, avgAcceptMins: null, onTimeRate: 100, ...o,
});

// ────────────────────────────── reliabilityScore ──────────────────────────────

test('a flawless record scores near 1, a disastrous one near 0', () => {
  assert.ok(reliabilityScore(row()) > 0.95);
  const bad = row({ onTime: 0, chases: 30, escalations: 10 });
  assert.ok(reliabilityScore(bad) < 0.05);
});

test('no deadlines yet is treated as neutral, not as failure', () => {
  // withDue 0 must not read as "never on time".
  const s = reliabilityScore(row({ withDue: 0, onTime: 0 }));
  assert.ok(s > 0.5, `expected neutral-ish, got ${s}`);
});

test('chasing costs more than a single late delivery', () => {
  const chased = reliabilityScore(row({ chases: 10 }));      // needed a chase every task
  const oneLate = reliabilityScore(row({ onTime: 7 }));       // one task late, never chased
  assert.ok(chased < oneLate);
});

test('null input is safe', () => {
  assert.equal(reliabilityScore(null), null);
});

// ────────────────────────────── memberProfile: cold start ──────────────────────────────

test('no history at all → exactly today\'s constants', () => {
  const p = memberProfile(null);
  assert.equal(p.tier, 'steady');
  assert.equal(p.acceptWaitMs, ACCEPT_WAIT_MS);
  assert.equal(p.maxAcceptPings, MAX_ACCEPT_PINGS);
  assert.equal(p.maxOverdueChases, MAX_OVERDUE_CHASES);
});

test('too few completed tasks stays steady however good the ratios look', () => {
  const p = memberProfile(row({ completed: MIN_PROFILE_SAMPLES - 1, assigned: 3, withDue: 3, onTime: 3 }));
  assert.equal(p.tier, 'steady', 'three perfect tasks is not a track record');
  assert.equal(p.maxAcceptPings, MAX_ACCEPT_PINGS);
});

test('too few completed tasks also protects against an early bad run', () => {
  const p = memberProfile(row({ completed: 2, assigned: 3, onTime: 0, chases: 9, escalations: 3 }));
  assert.equal(p.tier, 'steady', 'nobody is written off on two tasks');
});

// ────────────────────────────── memberProfile: tiers ──────────────────────────────

test('a strong record with enough samples earns more rope', () => {
  const p = memberProfile(row());
  assert.equal(p.tier, 'proven');
  assert.ok(p.maxAcceptPings > MAX_ACCEPT_PINGS);
  assert.ok(p.overdueChaseMs > DEFAULT_POLICY.overdueChaseMs, 'proven members are chased less often');
});

test('a weak record with enough samples gets the owner in early', () => {
  const p = memberProfile(row({ onTime: 1, chases: 22, escalations: 6 }));
  assert.equal(p.tier, 'shaky');
  assert.equal(p.maxAcceptPings, 1);
  assert.equal(p.maxOverdueChases, 1);
  assert.ok(p.overdueChaseMs < DEFAULT_POLICY.overdueChaseMs);
});

test('the middle of the range stays steady', () => {
  const p = memberProfile(row({ onTime: 5, chases: 5, escalations: 1 }));
  assert.equal(p.tier, 'steady');
});

// ────────────────────────────── acceptWait: wait for THEIR normal ──────────────────────────────

test('a fast responder is nudged sooner than the flat two hours', () => {
  const p = memberProfile(row({ avgAcceptMins: 5 }));
  assert.ok(p.acceptWaitMs < ACCEPT_WAIT_MS, 'silence from a 5-minute responder means something');
  assert.equal(p.acceptWaitMs, ACCEPT_WAIT_MIN_MS, 'but never sooner than the floor');
});

test('a slow-but-steady responder is given their usual runway', () => {
  const p = memberProfile(row({ avgAcceptMins: 90 }));
  assert.equal(p.acceptWaitMs, 135 * MIN, '90 min * 1.5 — not pinged for behaving normally');
  assert.ok(p.acceptWaitMs > ACCEPT_WAIT_MS);
});

test('an extreme latency is capped, not honoured indefinitely', () => {
  assert.equal(memberProfile(row({ avgAcceptMins: 5000 })).acceptWaitMs, ACCEPT_WAIT_MAX_MS);
});

test('acceptWait is independent of tier — a shaky member who answers fast still gets the floor', () => {
  const p = memberProfile(row({ onTime: 0, chases: 30, escalations: 9, avgAcceptMins: 4 }));
  assert.equal(p.tier, 'shaky');
  assert.equal(p.acceptWaitMs, ACCEPT_WAIT_MIN_MS);
});

test('avgAcceptMins rides along for escalation copy, null when unknown', () => {
  assert.equal(memberProfile(row({ avgAcceptMins: 20 })).avgAcceptMins, 20);
  assert.equal(memberProfile(row()).avgAcceptMins, null);
});

// ────────────────────────────── decideDelegationAction with a policy ──────────────────────────────

test('omitting the policy preserves the exact behaviour the loop always had', () => {
  const t = { status: 'in_progress', payload: { accept_pings: MAX_ACCEPT_PINGS } };
  assert.equal(decideDelegationAction(t, NOW).action, 'escalate_no_accept');
  assert.equal(decideDelegationAction(t, NOW, DEFAULT_POLICY).action, 'escalate_no_accept');
});

test('a proven member gets an extra ping before the owner is bothered', () => {
  const proven = memberProfile(row());
  const t = { status: 'in_progress', payload: { accept_pings: MAX_ACCEPT_PINGS } };
  assert.equal(decideDelegationAction(t, NOW).action, 'escalate_no_accept');
  assert.equal(decideDelegationAction(t, NOW, proven).action, 'accept_ping');
});

test('a shaky member reaches the owner after one unanswered ping', () => {
  const shaky = memberProfile(row({ onTime: 0, chases: 30, escalations: 9 }));
  const t = { status: 'in_progress', payload: { accept_pings: 1 } };
  assert.equal(decideDelegationAction(t, NOW).action, 'accept_ping');
  assert.equal(decideDelegationAction(t, NOW, shaky).action, 'escalate_no_accept');
});

test('shaky + urgent + overdue skips the chase ladder entirely', () => {
  const shaky = memberProfile(row({ onTime: 0, chases: 30, escalations: 9 }));
  const t = {
    status: 'in_progress', accepted_at: '2026-07-24T07:00:00Z',
    due_at: new Date(NOW - 3600000).toISOString(), urgency: 'high', chase_count: 0, payload: {},
  };
  assert.equal(decideDelegationAction(t, NOW).action, 'overdue_chase');
  assert.equal(decideDelegationAction(t, NOW, shaky).action, 'escalate_overdue');
});

test('the urgent skip fires once, then falls back to waiting', () => {
  const shaky = memberProfile(row({ onTime: 0, chases: 30, escalations: 9 }));
  const t = {
    status: 'in_progress', accepted_at: '2026-07-24T07:00:00Z',
    due_at: new Date(NOW - 3600000).toISOString(), urgency: 'high',
    chase_count: 1, escalated_at: '2026-07-24T08:30:00Z', payload: {},
  };
  assert.equal(decideDelegationAction(t, NOW, shaky).action, 'overdue_waiting', 'never escalate twice');
});

// ────────────────────────────── A4.1 client-facing and at risk ──────────────────────────────

test('a client is waiting, nobody has confirmed, deadline is close → owner now', () => {
  const t = {
    status: 'in_progress', customer_id: 'cust-1', payload: { accept_pings: 0 },
    due_at: new Date(NOW + 30 * MIN).toISOString(), // inside the pre-due window
  };
  assert.equal(decideDelegationAction(t, NOW).action, 'escalate_client_risk',
    'a client waiting beats a remaining ping budget');
});

test('the same task without a client just keeps pinging', () => {
  const t = {
    status: 'in_progress', payload: { accept_pings: 0 },
    due_at: new Date(NOW + 30 * MIN).toISOString(),
  };
  assert.equal(decideDelegationAction(t, NOW).action, 'accept_ping');
});

test('a client task still far from its deadline is not escalated early', () => {
  const t = {
    status: 'in_progress', customer_id: 'cust-1', payload: { accept_pings: 0 },
    due_at: new Date(NOW + PREDUE_WINDOW_MS + MIN).toISOString(),
  };
  assert.equal(decideDelegationAction(t, NOW).action, 'accept_ping');
});

test('client-risk escalates once, then rejoins the normal ladder', () => {
  const t = {
    status: 'in_progress', customer_id: 'cust-1', escalated_at: '2026-07-24T08:00:00Z',
    payload: { accept_pings: 0 }, due_at: new Date(NOW + 30 * MIN).toISOString(),
  };
  assert.equal(decideDelegationAction(t, NOW).action, 'accept_ping', 'no second alarm for the same thing');
});

test('an accepted client task is unaffected — this rule is about silence', () => {
  const t = {
    status: 'in_progress', customer_id: 'cust-1', accepted_at: '2026-07-24T08:00:00Z',
    payload: {}, due_at: new Date(NOW + 30 * MIN).toISOString(),
  };
  assert.equal(decideDelegationAction(t, NOW).action, 'predue_reminder');
});
