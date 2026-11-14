import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  orderNumber, orderItemLines, deliveryDetails, isPaid, planOrderWork, orderTaskDefs, orderGroupCard,
  openTasks, allTeamWorkDone, paidNoteForAssignee, cancelNoteForAssignee, teamDoneOwnerNote,
  findDuplicateOrder, ordersForPrompt,
} from '../orderTeamLogic.mjs';
import { decideDelegationAction, neverRouted, ROUTE_GRACE_MS } from '../delegationLogic.mjs';

const src = rel => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
const member = (role, extra = {}) => ({ id: role, role, contact_telegram: 111, is_active: true, ...extra });
const order = (over = {}) => ({
  id: '11111111-2222-3333-4444-555555a1b2c3', status: 'pending_payment', total: 1400, currency: 'ETB',
  items: [{ name: 'Tibs', quantity: 2, unit_price: 700, subtotal: 1400, currency: 'ETB' }],
  customer_note: 'Deliver to: Bole, near Edna Mall · Phone: 0911223344 · By: 2026-11-20',
  created_at: '2026-11-14T10:00:00Z', ...over,
});

test('order number is the one the customer was shown', () => {
  assert.equal(orderNumber(order()), 'A1B2C3');
});

test('item lines read both saved shapes', () => {
  assert.deepEqual(orderItemLines(order()), ['2 × Tibs (1,400 ETB)']);
  assert.deepEqual(orderItemLines({ currency: 'ETB', items: [{ name: 'Coffee', qty: 3, price: 50 }] }), ['3 × Coffee (150 ETB)']);
  assert.deepEqual(orderItemLines({ items: [{ name: 'Gift wrap' }] }), ['1 × Gift wrap']);
  assert.deepEqual(orderItemLines({}), []);
});

test('delivery details come from the brain, or back out of the saved note', () => {
  assert.deepEqual(deliveryDetails(order()), { address: 'Bole, near Edna Mall', phone: '0911223344', deadline: '2026-11-20', needsDelivery: true });
  assert.equal(deliveryDetails(order({ customer_note: 'Deliver to: pickup · Phone: 0911223344' })).needsDelivery, false);
  assert.equal(deliveryDetails(order({ customer_note: null })).needsDelivery, false);
  const given = deliveryDetails(order({ customer_note: null }), { address: 'CMC', phone: 'not provided', deadlineLabel: 'by Friday' });
  assert.deepEqual(given, { address: 'CMC', phone: null, deadline: 'by Friday', needsDelivery: true });
});

test('a solo owner gets no tasks at all', () => {
  assert.deepEqual(planOrderWork({ members: [], needsDelivery: true }), { prep: false, prepRole: null, delivery: false });
  // On the team but with no Telegram to reach them on: same as nobody.
  assert.equal(planOrderWork({ members: [member('other', { contact_telegram: null })] }).prep, false);
});

test('prepare goes to general staff, or to the one role the shop has', () => {
  assert.equal(planOrderWork({ members: [member('other'), member('delivery')] }).prepRole, 'other');
  assert.equal(planOrderWork({ members: [member('catering')] }).prepRole, 'catering');
  assert.equal(planOrderWork({ members: [member('catering'), member('other')] }).prepRole, 'other');
  // Several specialists and no general staff: anyone (the owner picks).
  assert.equal(planOrderWork({ members: [member('designer'), member('printer')] }).prepRole, null);
});

test('a delivery task needs both an address and a courier', () => {
  const kitchen = [member('catering')];
  const withCourier = [member('catering'), member('delivery')];
  assert.equal(planOrderWork({ members: kitchen, needsDelivery: true }).delivery, false);
  assert.equal(planOrderWork({ members: withCourier, needsDelivery: true }).delivery, true);
  assert.equal(planOrderWork({ members: withCourier, needsDelivery: false }).delivery, false);
  // Only a courier on the team: nothing to prepare with, but they can deliver.
  assert.deepEqual(planOrderWork({ members: [member('delivery')], needsDelivery: true }), { prep: false, prepRole: null, delivery: true });
});

test('tasks carry the order, the address and the payment state', () => {
  const o = order();
  const delivery = deliveryDetails(o);
  const plan = planOrderWork({ members: [member('other'), member('delivery')], needsDelivery: delivery.needsDelivery });
  const defs = orderTaskDefs({ order: o, customerName: 'Sara', delivery, notes: 'no onions', plan });
  assert.deepEqual(defs.map(d => [d.title, d.role]), [['Prepare order #A1B2C3', 'other'], ['Arrange delivery for order #A1B2C3', 'delivery']]);
  for (const d of defs) {
    assert.match(d.description, /Customer: Sara/);
    assert.match(d.description, /2 × Tibs/);
    assert.match(d.description, /Bole, near Edna Mall/);
    assert.match(d.description, /no onions/);
    assert.match(d.description, /Payment: not received yet/);
  }
  const paid = orderTaskDefs({ order: order({ status: 'paid' }), customerName: 'Sara', delivery, plan });
  assert.match(paid[0].description, /Payment: received\./);
});

test('no courier: the address stays in the prepare task', () => {
  const o = order();
  const delivery = deliveryDetails(o);
  const defs = orderTaskDefs({ order: o, customerName: 'Sara', delivery, plan: planOrderWork({ members: [member('catering')], needsDelivery: true }) });
  assert.equal(defs.length, 1);
  assert.equal(defs[0].role, 'catering');
  assert.match(defs[0].description, /Delivery\/pickup: Bole/);
});

test('the team group card shows what, where and whether it is paid', () => {
  const o = order();
  const card = orderGroupCard({ order: o, customerName: 'Sara', delivery: deliveryDetails(o) });
  assert.match(card, /New order #A1B2C3\* — Sara/);
  assert.match(card, /2 × Tibs/);
  assert.match(card, /Total: 1,400 ETB/);
  assert.match(card, /Deliver to: Bole/);
  assert.match(card, /Not paid yet/);
  assert.match(orderGroupCard({ order: order({ status: 'paid' }), customerName: 'Sara', delivery: deliveryDetails(o) }), /✅ Paid/);
});

test('team work is done only when nothing is open and something was finished', () => {
  const t = status => ({ status });
  assert.equal(allTeamWorkDone([]), false);
  assert.equal(allTeamWorkDone([t('completed'), t('in_progress')]), false);
  assert.equal(allTeamWorkDone([t('completed'), t('blocked')]), false);
  assert.equal(allTeamWorkDone([t('completed'), t('completed')]), true);
  assert.equal(allTeamWorkDone([t('completed'), t('cancelled')]), true);
  assert.equal(allTeamWorkDone([t('cancelled')]), false);
  assert.equal(openTasks([t('pending'), t('completed'), t('blocked')]).length, 2);
});

test('the owner is offered "mark delivered" only for a paid order', () => {
  assert.equal(teamDoneOwnerNote(order({ status: 'paid' })).offerDelivered, true);
  const unpaid = teamDoneOwnerNote(order());
  assert.equal(unpaid.offerDelivered, false);
  assert.match(unpaid.text, /still unpaid/);
  assert.equal(teamDoneOwnerNote(order({ status: 'fulfilled' })), null);
  assert.equal(teamDoneOwnerNote(order({ status: 'cancelled' })), null);
});

test('assignee notes name the order and the task', () => {
  const task = { title: 'Prepare order #A1B2C3' };
  assert.match(paidNoteForAssignee(order(), task), /#A1B2C3 is paid/);
  assert.match(cancelNoteForAssignee(order(), task), /cancelled.*stop work on "Prepare order #A1B2C3"/);
  assert.equal(isPaid(order({ status: 'fulfilled' })), true);
});

test('the same order twice in ten minutes is one order', () => {
  const now = Date.parse('2026-11-14T10:05:00Z');
  const items = [{ name: 'Tibs', quantity: 2 }];
  assert.equal(findDuplicateOrder(items, [order()], { nowMs: now })?.id, order().id);
  assert.equal(findDuplicateOrder([{ name: ' tibs ', quantity: 2 }], [order()], { nowMs: now })?.id, order().id);
  // A different quantity, an older order, or one already paid is a new order.
  assert.equal(findDuplicateOrder([{ name: 'Tibs', quantity: 3 }], [order()], { nowMs: now }), null);
  assert.equal(findDuplicateOrder(items, [order()], { nowMs: now + 20 * 60_000 }), null);
  assert.equal(findDuplicateOrder(items, [order({ status: 'paid' })], { nowMs: now }), null);
  assert.equal(findDuplicateOrder([], [order()], { nowMs: now }), null);
});

test('the brain is told each order and its real status', () => {
  const text = ordersForPrompt([order(), order({ status: 'fulfilled', id: 'x-000000ffeedd' })]);
  assert.match(text, /#A1B2C3: 2 × Tibs \(1,400 ETB\) · 1,400 ETB · awaiting payment · placed 14 Nov/);
  assert.match(text, /#FFEEDD: .* delivered/);
  assert.equal(ordersForPrompt([]), '');
});

test('a task that was never routed is picked up by the cron after a grace period', () => {
  const created = Date.parse('2026-11-14T10:00:00Z');
  const task = { status: 'pending', created_at: '2026-11-14T10:00:00Z', payload: { role: 'other' } };
  assert.equal(neverRouted(task, created + 60_000), false);
  assert.equal(neverRouted(task, created + ROUTE_GRACE_MS), true);
  assert.equal(decideDelegationAction(task, created + ROUTE_GRACE_MS).action, 'route');
  // The owner was already asked who should take it: leave it with them.
  assert.equal(decideDelegationAction({ ...task, payload: { assign_candidates: [] } }, created + 3_600_000).action, 'skip');
  assert.equal(decideDelegationAction({ ...task, supplier_id: 's1' }, created + 3_600_000).action, 'skip');
});

test('every place an order is created or moved tells the team', () => {
  const brain = src('lib/server/agentBrain.js');
  assert.match(brain, /fanOutOrderToTeam\(/);
  assert.doesNotMatch(brain, /createOrderDelegationTasks/);
  const engine = src('lib/server/replyEngine.js');
  assert.match(engine, /fanOutOrderToTeam\(/, 'fast checkout hands the order to the team');
  assert.ok((engine.match(/notifyTeamOrderPaid\(/g) || []).length >= 2, 'Stars and owner-confirmed payments');
  assert.ok((engine.match(/closeOrderTeamWork\(/g) || []).length >= 2, 'owner cancel and mark-delivered buttons');
  assert.match(src('app/api/payment/callback/route.js'), /notifyTeamOrderPaid\(/);
  assert.match(src('app/api/orders/route.js'), /closeOrderTeamWork\(/);
  assert.match(src('app/api/orders/[id]/refund/route.js'), /closeOrderTeamWork\(/);
  assert.match(src('lib/server/ownerOps.js'), /notifyTeamOrderPaid\(/);
  assert.match(src('lib/server/delegation.js'), /afterOrderTaskDone\(/);
});

test('the brain saves the order summary it sends and knows the customer\'s orders', () => {
  const brain = src('lib/server/agentBrain.js');
  assert.match(brain, /content: orderText/);
  assert.match(brain, /THIS CUSTOMER'S ORDERS/);
  assert.match(brain, /findDuplicateOrder\(/);
});
