/**
 * Order → team: keeps the people who do the work in step with the order.
 *
 *   placed     → fanOutOrderToTeam: "prepare" (+ "deliver") tasks, routed
 *                through the delegation loop, and a card in the team group
 *   paid       → notifyTeamOrderPaid: assignees and the group hear it's paid
 *   cancelled  → closeOrderTeamWork: open tasks are cancelled, assignees told
 *   delivered  → closeOrderTeamWork: open tasks are closed, assignees thanked
 *   team done  → afterOrderTaskDone: the owner gets "mark delivered"
 *
 * Every path that creates or moves an order calls in here, so it no longer
 * matters whether the order came from the agent brain, the fast checkout, a
 * Chapa callback or a button in the owner's chat. The rules are in
 * orderTeamLogic.mjs.
 *
 * None of these throw: the order itself must never fail because a teammate
 * couldn't be messaged.
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { sendAsOwnerOrBot, resolveToken } from './sendAs';
import { createDelegatedTask, proposeAssignment, postToTeamGroup, recordTaskEvent } from './delegation';
import {
  orderNumber, deliveryDetails, planOrderWork, orderTaskDefs, orderGroupCard,
  openTasks, allTeamWorkDone, paidNoteForAssignee, cancelNoteForAssignee,
  deliveredNoteForAssignee, teamDoneOwnerNote,
} from './orderTeamLogic.mjs';

// How long an order waits for the team to be briefed before the customer path
// moves on. Anything not routed by then is picked up by the hourly delegation
// cron (runDelegationPass routes tasks that were created but never assigned).
const ROUTING_WAIT_MS = 20_000;

const ownerChatId = business => business?.owner_private_chat_id || business?.owner_telegram_id || null;
const warn = (where, e) => console.warn(`[orderTeam] ${where}:`, e?.message || e);

async function orderTasks(sb, orderId) {
  const { data } = await sb.from('agent_tasks')
    .select('id, business_id, title, status, supplier_id, supplier_name, order_id, payload')
    .eq('order_id', orderId).eq('type', 'delegated_task')
    .order('created_at', { ascending: true });
  return data || [];
}

async function messageAssignee({ sb, business, task, text }) {
  if (!task.supplier_id) return false;
  const { data: supplier } = await sb.from('suppliers')
    .select('id, contact_telegram, contact_channel').eq('id', task.supplier_id).eq('is_active', true).maybeSingle();
  if (!supplier?.contact_telegram) return false;
  const res = await sendAsOwnerOrBot({
    sb, business, chatId: supplier.contact_telegram, payload: { text }, prefer: supplier.contact_channel || 'auto',
  }).catch(e => { warn('message assignee', e); return { ok: false }; });
  if (res?.ok) {
    // Into the same thread teamBrain reads, so its next message to this
    // person knows what they were already told.
    try {
      const { recordTeamTurn } = await import('./teamBrain');
      await recordTeamTurn(sb, { businessId: business.id, supplierId: supplier.id, taskId: task.id, role: 'us', text, kind: 'text' });
    } catch (e) { warn('record team turn', e); }
  }
  return !!res?.ok;
}

/**
 * Give a new order to the team. Safe to call more than once for an order: the
 * second call finds the tasks and does nothing.
 *
 * A shop with nobody to hand work to (no reachable team member, no team
 * group) is skipped entirely — the owner already has the new-order message,
 * and "I couldn't assign this" on every order is noise for someone working
 * alone. A shop with only a team group gets the card there and no tasks.
 *
 * Returns { taskIds, skipped? }.
 */
export async function fanOutOrderToTeam({
  sb = supabase(), token, business, order, customer, conversationId = null,
  address, phone, deadlineIso, deadlineLabel, notes,
}) {
  try {
    if (!order?.id || !business?.id) return { taskIds: [], skipped: 'no_order' };
    const existing = await orderTasks(sb, order.id);
    if (existing.length) return { taskIds: existing.map(t => t.id), skipped: 'already_fanned_out' };

    const { data: members } = await sb.from('suppliers')
      .select('id, role, contact_telegram, is_active')
      .eq('business_id', business.id).eq('is_active', true)
      .not('contact_telegram', 'is', null).limit(100);
    const delivery = deliveryDetails(order, { address, phone, deadlineIso, deadlineLabel });
    const plan = planOrderWork({ members: members || [], needsDelivery: delivery.needsDelivery });
    const hasGroup = !!business.business_group_chat_id;
    if (!hasGroup && !plan.prep && !plan.delivery) return { taskIds: [], skipped: 'no_team' };

    const botToken = token || resolveToken(business);
    const customerName = customer?.name || (customer?.telegram_username ? `@${customer.telegram_username}` : null) || 'Customer';

    await postToTeamGroup(botToken, business, orderGroupCard({ order, customerName, delivery }));

    const taskIds = [];
    const routing = [];
    for (const def of orderTaskDefs({ order, customerName, delivery, notes, plan })) {
      const row = await createDelegatedTask(sb, business, {
        title: def.title, description: def.description, role: def.role,
        due_at: deadlineIso || null,
        customer_id: customer?.id || order.customer_id || null,
        created_by: 'order',
        source_conversation_id: conversationId || order.conversation_id || null,
        order_id: order.id,
      });
      if (!row.ok) { warn('create task', row.error); continue; }
      taskIds.push(row.task.id);
      routing.push(proposeAssignment({ sb, token: botToken, business, task: row.task }).catch(e => warn('route task', e)));
    }
    // Wait for the briefs to go out, but not forever: on a serverless host an
    // un-awaited send dies with the request.
    await Promise.race([Promise.allSettled(routing), new Promise(r => setTimeout(r, ROUTING_WAIT_MS))]);
    return { taskIds };
  } catch (e) {
    warn('fanOutOrderToTeam', e);
    return { taskIds: [] };
  }
}

/** The order was paid: tell whoever is working on it, and the group. */
export async function notifyTeamOrderPaid({ sb = supabase(), token, business, order }) {
  try {
    if (!order?.id || !business?.id) return { notified: 0 };
    const open = openTasks(await orderTasks(sb, order.id));
    if (!open.length) return { notified: 0 };
    let notified = 0;
    for (const task of open) {
      await recordTaskEvent(sb, task, { actor: 'agent', action: 'order_paid', note: `Order #${orderNumber(order)} paid` });
      if (await messageAssignee({ sb, business, task, text: paidNoteForAssignee(order, task) })) notified++;
    }
    await postToTeamGroup(token || resolveToken(business), business, `💰 Order #${orderNumber(order)} is *paid*.`);
    return { notified };
  } catch (e) {
    warn('notifyTeamOrderPaid', e);
    return { notified: 0 };
  }
}

/**
 * The order is over — cancelled (also refunded / expired) or delivered. Close
 * whatever the team still has open for it so nobody keeps working, and the
 * delegation cron stops chasing them.
 *
 * outcome: 'cancelled' | 'delivered'
 */
export async function closeOrderTeamWork({ sb = supabase(), token, business, order, outcome = 'cancelled' }) {
  try {
    if (!order?.id || !business?.id) return { closed: 0 };
    const open = openTasks(await orderTasks(sb, order.id));
    if (!open.length) return { closed: 0 };
    const delivered = outcome === 'delivered';
    const now = new Date().toISOString();
    for (const task of open) {
      await sb.from('agent_tasks').update(delivered
        ? { status: 'completed', completed_at: now, completion_note: 'Order marked delivered' }
        : { status: 'cancelled' }).eq('id', task.id);
      await recordTaskEvent(sb, task, {
        actor: 'agent', action: delivered ? 'completed' : 'cancelled',
        note: `Order #${orderNumber(order)} ${delivered ? 'marked delivered' : 'cancelled'}`,
      });
      await messageAssignee({
        sb, business, task,
        text: delivered ? deliveredNoteForAssignee(order, task) : cancelNoteForAssignee(order, task),
      });
    }
    await postToTeamGroup(token || resolveToken(business), business, delivered
      ? `📦 Order #${orderNumber(order)} — delivered.`
      : `✗ Order #${orderNumber(order)} was cancelled. No more work needed on it.`);
    return { closed: open.length };
  } catch (e) {
    warn('closeOrderTeamWork', e);
    return { closed: 0 };
  }
}

/**
 * Orders that expired from age (a month unpaid, or the owner's tidy-up): drop
 * whatever tasks still point at them, without messaging anyone about work that
 * went stale weeks ago.
 */
export async function cancelTeamWorkForOrders(sb, orderIds = []) {
  try {
    if (!orderIds.length) return;
    await sb.from('agent_tasks').update({ status: 'cancelled' })
      .in('order_id', orderIds).eq('type', 'delegated_task')
      .in('status', ['pending', 'in_progress', 'blocked']);
  } catch (e) {
    warn('cancelTeamWorkForOrders', e);
  }
}

/**
 * A task that belongs to an order was just completed. When that was the last
 * one, hand the order back to the owner with the next step — otherwise the
 * work finishes and the order sits at "paid" until someone remembers it.
 */
export async function afterOrderTaskDone({ sb = supabase(), token, business, task }) {
  try {
    if (!task?.order_id) return { done: false };
    const tasks = await orderTasks(sb, task.order_id);
    if (!allTeamWorkDone(tasks)) return { done: false };
    const { data: order } = await sb.from('orders')
      .select('id, status, total, currency').eq('id', task.order_id).maybeSingle();
    const note = order && teamDoneOwnerNote(order);
    const chatId = ownerChatId(business);
    if (!note || !chatId) return { done: true };
    await tg(token || resolveToken(business), 'sendMessage', {
      chat_id: chatId,
      text: note.text,
      ...(note.offerDelivered
        ? { reply_markup: { inline_keyboard: [[{ text: '📦 Mark delivered', callback_data: `order_fulfill_${order.id}` }]] } }
        : {}),
    });
    return { done: true };
  } catch (e) {
    warn('afterOrderTaskDone', e);
    return { done: false };
  }
}
