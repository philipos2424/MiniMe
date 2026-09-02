import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPlanAction } from '../delegationLogic.mjs';

// A job_steps row, in order_index order.
const step = (o = {}) => ({
  id: o.id || 'S', order_index: o.order_index ?? 0, label: o.label || 'Step',
  role: 'designer', auto: true, status: 'idle', ...o,
});

test('the first unfinished step is the one to delegate', () => {
  const out = nextPlanAction([
    step({ id: 'a', status: 'done' }),
    step({ id: 'b', status: 'idle' }),
    step({ id: 'c', status: 'idle' }),
  ]);
  assert.equal(out.action, 'delegate');
  assert.equal(out.step.id, 'b');
});

test('done and skipped steps are both passed over', () => {
  const out = nextPlanAction([
    step({ id: 'a', status: 'done' }),
    step({ id: 'b', status: 'skipped' }),
    step({ id: 'c', status: 'idle' }),
  ]);
  assert.equal(out.step.id, 'c');
});

test('a step already in flight stops the plan — nobody is briefed twice', () => {
  const out = nextPlanAction([
    step({ id: 'a', status: 'done' }),
    step({ id: 'b', status: 'waiting' }),   // live task, own chase schedule
    step({ id: 'c', status: 'idle' }),
  ]);
  assert.equal(out.action, 'in_flight');
  assert.equal(out.step.id, 'b', 'and it reports which step it is waiting on');
});

test('a client step waits on the client, not on the team', () => {
  const out = nextPlanAction([step({ id: 'a', role: 'client', status: 'idle' })]);
  assert.equal(out.action, 'await_client');
});

test('a passive agent step is auto-completed, one at a time', () => {
  const out = nextPlanAction([
    step({ id: 'a', role: 'agent', auto: true, status: 'idle' }),
    step({ id: 'b', status: 'idle' }),
  ]);
  assert.equal(out.action, 'auto_complete');
  assert.equal(out.step.id, 'a', 'the caller marks it done and asks again');
});

test('a NON-auto agent step is a person doing something, so it is delegated', () => {
  const out = nextPlanAction([step({ id: 'a', role: 'agent', auto: false, status: 'idle' })]);
  assert.equal(out.action, 'delegate');
});

test('nothing left to do means the job is finished', () => {
  assert.equal(nextPlanAction([
    step({ id: 'a', status: 'done' }),
    step({ id: 'b', status: 'skipped' }),
  ]).action, 'job_complete');
});

test('an empty or missing step list is complete, not a crash', () => {
  assert.equal(nextPlanAction([]).action, 'job_complete');
  assert.equal(nextPlanAction(null).action, 'job_complete');
  assert.equal(nextPlanAction(undefined).step, null);
});

test('in-flight beats everything after it, however urgent that looks', () => {
  // A later client step must not jump the queue while a task is live.
  const out = nextPlanAction([
    step({ id: 'a', status: 'waiting' }),
    step({ id: 'b', role: 'client', status: 'idle' }),
  ]);
  assert.equal(out.action, 'in_flight');
});

test('order_index order is respected as given — the caller sorts', () => {
  const out = nextPlanAction([
    step({ id: 'first', order_index: 0, status: 'idle' }),
    step({ id: 'second', order_index: 1, status: 'idle' }),
  ]);
  assert.equal(out.step.id, 'first');
});

test('a blocked step is still the next thing to act on, not skipped past', () => {
  // 'blocked' is not done: the plan should stop there rather than silently
  // briefing the step behind it and leaving the blockage buried.
  const out = nextPlanAction([
    step({ id: 'a', status: 'blocked' }),
    step({ id: 'b', status: 'idle' }),
  ]);
  assert.equal(out.step.id, 'a');
});
