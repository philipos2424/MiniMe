/**
 * orderTeam.js end to end against an in-memory database and a recorded
 * Telegram: what the team is actually sent as an order is placed, paid,
 * cancelled, delivered and finished.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as logic from '../orderTeamLogic.mjs';

const source = readFileSync(new URL('../orderTeam.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
  .replace(/^export /gm, '')
  .replace("await import('./teamBrain')", 'teamBrain');

function fakeDb(seed) {
  const tables = { suppliers: [], agent_tasks: [], orders: [], ...seed };
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.one = false; }
    select() { return this; }
    update(v) { this.op = 'update'; this.v = v; return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; }
    in(k, vs) { this.f.push(r => vs.includes(r[k])); return this; }
    not(k, _op, v) { this.f.push(r => r[k] !== v && r[k] !== undefined); return this; }
    order() { return this; }
    limit() { return this; }
    maybeSingle() { this.one = true; return this; }
    then(res, rej) {
      const hits = tables[this.t].filter(r => this.f.every(f => f(r)));
      if (this.op === 'update') hits.forEach(r => Object.assign(r, this.v));
      return Promise.resolve({ data: this.one ? (hits[0] || null) : hits, error: null }).then(res, rej);
    }
  }
  return { tables, from: t => new Q(t) };
}

function setup({ members = [], group = null, trusted = true, orderOver = {} } = {}) {
  const order = {
    id: '11111111-2222-3333-4444-555555a1b2c3', business_id: 'biz', customer_id: 'cust', status: 'pending_payment',
    total: 1400, currency: 'ETB', items: [{ name: 'Tibs', quantity: 2, subtotal: 1400, currency: 'ETB' }],
    customer_note: 'Deliver to: Bole · Phone: 0911223344', ...orderOver,
  };
  const db = fakeDb({ suppliers: members.map(m => ({ business_id: 'biz', is_active: true, ...m })), orders: [order] });
  const sent = { group: [], members: [], owner: [], events: [], turns: [] };
  let n = 0;
  const deps = {
    supabase: () => db,
    tg: async (_token, _method, body) => { sent.owner.push(body); return { ok: true }; },
    sendAsOwnerOrBot: async ({ chatId, payload }) => { sent.members.push({ chatId, text: payload.text }); return { ok: true }; },
    resolveToken: () => 'TOKEN',
    createDelegatedTask: async (_sb, business, t) => {
      const task = { id: `task-${++n}`, business_id: business.id, type: 'delegated_task', status: 'pending', supplier_id: null, payload: { role: t.role }, ...t };
      db.tables.agent_tasks.push(task);
      return { ok: true, task };
    },
    // Stand-in for the real router: a trusted shop auto-assigns by role.
    proposeAssignment: async ({ task }) => {
      const who = db.tables.suppliers.find(s => !task.payload.role || s.role === task.payload.role);
      if (trusted && who) Object.assign(task, { status: 'in_progress', supplier_id: who.id, supplier_name: who.name });
      return { ok: true };
    },
    postToTeamGroup: async (_token, business, text) => { if (business.business_group_chat_id) sent.group.push(text); return null; },
    recordTaskEvent: async (_sb, task, e) => { sent.events.push({ task: task.id, ...e }); },
    teamBrain: { recordTeamTurn: async (_sb, t) => { sent.turns.push(t); } },
    ...logic,
  };
  const api = new Function(...Object.keys(deps),
    `${source}\nreturn { fanOutOrderToTeam, notifyTeamOrderPaid, closeOrderTeamWork, afterOrderTaskDone, cancelTeamWorkForOrders };`)(...Object.values(deps));
  const business = { id: 'biz', name: 'Fefey', owner_telegram_id: 999, business_group_chat_id: group };
  const customer = { id: 'cust', name: 'Sara' };
  return { api, db, sent, order, business, customer };
}

const KITCHEN = { id: 'k1', name: 'Hana', role: 'other', contact_telegram: 501 };
const COURIER = { id: 'c1', name: 'Yonas', role: 'delivery', contact_telegram: 502 };

test('a new order becomes prepare + deliver tasks and a card in the team group', async () => {
  const t = setup({ members: [KITCHEN, COURIER], group: -100 });
  const r = await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer, conversationId: 'conv' });
  assert.equal(r.taskIds.length, 2);
  const [prep, deliver] = t.db.tables.agent_tasks;
  assert.equal(prep.title, 'Prepare order #A1B2C3');
  assert.equal(prep.supplier_id, 'k1');
  assert.equal(deliver.title, 'Arrange delivery for order #A1B2C3');
  assert.equal(deliver.supplier_id, 'c1');
  for (const task of [prep, deliver]) {
    assert.equal(task.order_id, t.order.id);
    assert.equal(task.customer_id, 'cust');
    assert.equal(task.source_conversation_id, 'conv');
  }
  assert.equal(t.sent.group.length, 1);
  assert.match(t.sent.group[0], /New order #A1B2C3\* — Sara/);
});

test('fan-out runs once per order', async () => {
  const t = setup({ members: [KITCHEN] });
  await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  const again = await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  assert.equal(again.skipped, 'already_fanned_out');
  assert.equal(t.db.tables.agent_tasks.length, 1);
});

test('a shop with no team gets no tasks and no noise', async () => {
  const t = setup();
  const r = await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  assert.deepEqual(r, { taskIds: [], skipped: 'no_team' });
  assert.equal(t.db.tables.agent_tasks.length, 0);
  assert.equal(t.sent.owner.length + t.sent.members.length + t.sent.group.length, 0);
});

test('a shop with only a team group gets the card there and no unassignable tasks', async () => {
  const t = setup({ group: -100 });
  const r = await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  assert.deepEqual(r.taskIds, []);
  assert.equal(t.sent.group.length, 1);
});

test('when the order is paid, whoever is working on it is told, and so is the group', async () => {
  const t = setup({ members: [KITCHEN, COURIER], group: -100 });
  await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  t.sent.group.length = 0;
  const r = await t.api.notifyTeamOrderPaid({ business: t.business, order: { ...t.order, status: 'paid' } });
  assert.equal(r.notified, 2);
  assert.deepEqual(t.sent.members.map(m => m.chatId), [501, 502]);
  assert.match(t.sent.members[0].text, /Order #A1B2C3 is paid/);
  assert.match(t.sent.group[0], /#A1B2C3 is \*paid\*/);
  // Recorded in each member's thread, so the next teamBrain message knows.
  assert.equal(t.sent.turns.length, 2);
  assert.ok(t.sent.events.every(e => e.action === 'order_paid'));
});

test('a paid order nobody was assigned says nothing', async () => {
  const t = setup({ members: [KITCHEN] });
  const r = await t.api.notifyTeamOrderPaid({ business: t.business, order: t.order });
  assert.equal(r.notified, 0);
  assert.equal(t.sent.members.length, 0);
});

test('a cancelled order stops the work: tasks cancelled, assignees told', async () => {
  const t = setup({ members: [KITCHEN, COURIER], group: -100 });
  await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  const r = await t.api.closeOrderTeamWork({ business: t.business, order: t.order, outcome: 'cancelled' });
  assert.equal(r.closed, 2);
  assert.ok(t.db.tables.agent_tasks.every(task => task.status === 'cancelled'));
  assert.match(t.sent.members[0].text, /was cancelled\. Please stop work on "Prepare order #A1B2C3"/);
  assert.match(t.sent.group.at(-1), /cancelled/);
  // Nothing left open, so a second call is a no-op.
  assert.equal((await t.api.closeOrderTeamWork({ business: t.business, order: t.order })).closed, 0);
});

test('marking the order delivered closes whatever the team still had open', async () => {
  const t = setup({ members: [KITCHEN] });
  await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  await t.api.closeOrderTeamWork({ business: t.business, order: t.order, outcome: 'delivered' });
  const task = t.db.tables.agent_tasks[0];
  assert.equal(task.status, 'completed');
  assert.ok(task.completed_at);
  assert.match(t.sent.members[0].text, /marked delivered/);
});

test('when the last task is done the owner gets "mark delivered" for a paid order', async () => {
  const t = setup({ members: [KITCHEN, COURIER], orderOver: { status: 'paid' } });
  await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  const [prep, deliver] = t.db.tables.agent_tasks;
  prep.status = 'completed';
  assert.deepEqual(await t.api.afterOrderTaskDone({ business: t.business, task: prep }), { done: false });
  assert.equal(t.sent.owner.length, 0);
  deliver.status = 'completed';
  assert.deepEqual(await t.api.afterOrderTaskDone({ business: t.business, task: deliver }), { done: true });
  assert.equal(t.sent.owner.length, 1);
  assert.equal(t.sent.owner[0].chat_id, 999);
  assert.equal(t.sent.owner[0].reply_markup.inline_keyboard[0][0].callback_data, `order_fulfill_${t.order.id}`);
});

test('team done on an unpaid order: the owner is told, with no delivered button', async () => {
  const t = setup({ members: [KITCHEN] });
  await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  const task = t.db.tables.agent_tasks[0];
  task.status = 'completed';
  await t.api.afterOrderTaskDone({ business: t.business, task });
  assert.match(t.sent.owner[0].text, /still unpaid/);
  assert.equal(t.sent.owner[0].reply_markup, undefined);
});

test('a task that is not for an order changes nothing', async () => {
  const t = setup({ members: [KITCHEN] });
  assert.deepEqual(await t.api.afterOrderTaskDone({ business: t.business, task: { id: 'x', order_id: null } }), { done: false });
});

test('expired orders drop their tasks quietly', async () => {
  const t = setup({ members: [KITCHEN] });
  await t.api.fanOutOrderToTeam({ business: t.business, order: t.order, customer: t.customer });
  await t.api.cancelTeamWorkForOrders(t.db, [t.order.id]);
  assert.equal(t.db.tables.agent_tasks[0].status, 'cancelled');
  assert.equal(t.sent.members.length, 0);
});

test('a failure while messaging the team never throws into the order path', async () => {
  const t = setup({ members: [KITCHEN] });
  const broken = { from: () => { throw new Error('db down'); } };
  assert.deepEqual(await t.api.fanOutOrderToTeam({ sb: broken, business: t.business, order: t.order, customer: t.customer }), { taskIds: [] });
  assert.deepEqual(await t.api.notifyTeamOrderPaid({ sb: broken, business: t.business, order: t.order }), { notified: 0 });
  assert.deepEqual(await t.api.closeOrderTeamWork({ sb: broken, business: t.business, order: t.order }), { closed: 0 });
});
