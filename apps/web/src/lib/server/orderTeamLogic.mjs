/**
 * Order → team: the rules, with no database or Telegram in them.
 *
 * An order is not handled when the customer has a payment link. Someone has to
 * prepare it and, often, deliver it. These helpers decide what work an order
 * creates for the team and what the team is told as the order moves — placed,
 * paid, cancelled, delivered. orderTeam.js does the reads and sends.
 */

const OPEN = new Set(['pending', 'in_progress', 'blocked']);

/** The short number the customer was shown ("Order #A1B2C3"). */
export function orderNumber(order) {
  return String(order?.id || '').slice(-6).toUpperCase();
}

/** "2 × Tibs (700 ETB)" lines, whichever shape the items were saved in. */
export function orderItemLines(order) {
  const currency = order?.currency || 'ETB';
  return (Array.isArray(order?.items) ? order.items : []).map(it => {
    const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
    const name = it.name || it.product_name || it.product || 'item';
    const subtotal = it.subtotal != null ? Number(it.subtotal)
      : (it.unit_price ?? it.price) != null ? Number(it.unit_price ?? it.price) * qty : null;
    return `${qty} × ${name}${subtotal ? ` (${subtotal.toLocaleString()} ${it.currency || currency})` : ''}`;
  });
}

/**
 * Delivery details for an order. The agent brain passes them straight in; any
 * other caller gets them read back out of the note the brain saved
 * ("Deliver to: Bole · Phone: 0911… · By: 2026-11-20").
 */
export function deliveryDetails(order, given = {}) {
  const note = String(order?.customer_note || '');
  const part = label => (note.match(new RegExp(`(?:^| · )${label}: ([^·]+)`)) || [])[1]?.trim() || null;
  const address = (given.address ?? part('Deliver to')) || null;
  const phone = (given.phone ?? part('Phone')) || null;
  const deadline = (given.deadlineLabel ?? given.deadlineIso ?? part('By') ?? part('By \\(loose\\)')) || null;
  return {
    address,
    phone: phone && phone !== 'not provided' ? phone : null,
    deadline,
    needsDelivery: !!address && address.toLowerCase() !== 'pickup',
  };
}

export function isPaid(order) {
  return ['paid', 'fulfilled'].includes(order?.status);
}

/**
 * Which tasks this team can actually take for an order, from who is on it.
 *
 *   prep      someone other than a courier exists to prepare it
 *   prepRole  the role to route "prepare" to: 'other' when the shop has
 *             general staff, the one role everyone shares when there is only
 *             one, otherwise null (anyone — the owner picks, or the
 *             least-busy member gets it)
 *   delivery  it is going to an address AND someone has the delivery role.
 *             Without a courier the address stays in the prepare task rather
 *             than becoming a task nobody can be given.
 *
 * A task with no one to take it only produces "I couldn't assign this" for
 * the owner on every order, so it is never created.
 */
export function planOrderWork({ members = [], needsDelivery = false } = {}) {
  const roles = [...new Set(members
    .filter(m => m && m.contact_telegram && m.is_active !== false)
    .map(m => m.role || null))];
  const nonDelivery = roles.filter(r => r !== 'delivery');
  const prepRole = nonDelivery.length === 1 && nonDelivery[0]
    ? nonDelivery[0]
    : nonDelivery.includes('other') ? 'other' : null;
  return {
    prep: nonDelivery.length > 0,
    prepRole,
    delivery: needsDelivery && roles.includes('delivery'),
  };
}

/**
 * The tasks an order creates: "prepare", plus "deliver" when it is going to an
 * address and there is a courier. The description is everything the assignee
 * is given — they are told to ask rather than guess at what isn't in it.
 */
export function orderTaskDefs({ order, customerName, delivery, notes, plan = { prep: true, prepRole: 'other', delivery: delivery.needsDelivery } }) {
  const num = orderNumber(order);
  const context = [
    `Order #${num}`,
    `Customer: ${customerName || 'Customer'}`,
    `Items: ${orderItemLines(order).join('; ') || '(none listed)'}`,
    delivery.address && `Delivery/pickup: ${delivery.address}`,
    delivery.phone && `Phone: ${delivery.phone}`,
    delivery.deadline && `Customer deadline: ${delivery.deadline}`,
    notes && `Customer note: ${notes}`,
    isPaid(order)
      ? 'Payment: received.'
      : "Payment: not received yet. I'll message you the moment it's paid.",
    'Use only this context and the forwarded customer files. If anything is missing, ask MiniMe/owner instead of guessing.',
  ].filter(Boolean).join('\n');

  const defs = [];
  if (plan.prep) {
    defs.push({
      title: `Prepare order #${num}`,
      role: plan.prepRole,
      description: `${context}\n\nConfirm availability/prep status. Do not invent prices or promises.`,
    });
  }
  if (plan.delivery) {
    defs.push({
      title: `Arrange delivery for order #${num}`,
      role: 'delivery',
      description: `${context}\n\nConfirm delivery timing/address questions before marking done.`,
    });
  }
  return defs;
}

/** The new-order card for the team group. Markdown. */
export function orderGroupCard({ order, customerName, delivery }) {
  const lines = orderItemLines(order).map(l => `• ${l}`);
  return [
    `🛒 *New order #${orderNumber(order)}* — ${customerName || 'Customer'}`,
    ...lines,
    order?.total != null && `*Total: ${Number(order.total).toLocaleString()} ${order.currency || 'ETB'}*`,
    delivery.needsDelivery ? `📍 Deliver to: ${delivery.address}` : delivery.address ? '🏪 Pickup' : null,
    delivery.deadline && `⏰ By: ${delivery.deadline}`,
    isPaid(order) ? '✅ Paid' : '⏳ Not paid yet',
  ].filter(Boolean).join('\n');
}

export function openTasks(tasks = []) {
  return tasks.filter(t => OPEN.has(t.status));
}

/** Every task this order created is finished (and at least one actually was). */
export function allTeamWorkDone(tasks = []) {
  return tasks.length > 0 && openTasks(tasks).length === 0 && tasks.some(t => t.status === 'completed');
}

export function paidNoteForAssignee(order, task) {
  return `✅ Order #${orderNumber(order)} is paid, so "${task.title}" is good to go.`;
}

export function cancelNoteForAssignee(order, task) {
  return `✗ Order #${orderNumber(order)} was cancelled. Please stop work on "${task.title}", nothing more is needed.`;
}

export function deliveredNoteForAssignee(order, task) {
  return `📦 Order #${orderNumber(order)} was marked delivered, so "${task.title}" is closed. Thank you!`;
}

/** What the owner is told once the team has finished everything for an order. */
export function teamDoneOwnerNote(order) {
  const num = orderNumber(order);
  if (order.status === 'paid') return { text: `📦 The team has finished everything for order #${num}. Tap below once the customer has it.`, offerDelivered: true };
  if (order.status === 'pending_payment') return { text: `📦 The team has finished everything for order #${num}, but it is still unpaid.`, offerDelivered: false };
  return null; // delivered, cancelled, refunded, expired: nothing to add
}

function signature(items = []) {
  return items
    .map(it => `${String(it.name || it.product_name || '').trim().toLowerCase()}×${Number(it.quantity ?? it.qty ?? 1) || 1}`)
    .sort().join('|');
}

/**
 * The same unpaid order placed a moment ago, if there is one. A customer who
 * says "yes" or repeats the order while the brain is still mid-conversation
 * should get the order they already have, not a second one.
 */
export function findDuplicateOrder(items, recentOrders = [], { nowMs = Date.now(), windowMs = 10 * 60_000 } = {}) {
  const sig = signature(items);
  if (!sig) return null;
  return recentOrders.find(o => o.status === 'pending_payment'
    && nowMs - Date.parse(o.created_at) <= windowMs
    && signature(o.items) === sig) || null;
}

/** "- #A1B2C3: 2 × Tibs · 700 ETB · awaiting payment · placed 14 Nov" for the brain's prompt. */
export function ordersForPrompt(orders = []) {
  const label = { pending_payment: 'awaiting payment', paid: 'paid, being prepared', fulfilled: 'delivered', cancelled: 'cancelled', refunded: 'refunded', expired: 'expired' };
  return orders.map(o => {
    const placed = o.created_at ? new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    return `- #${orderNumber(o)}: ${orderItemLines(o).join(', ') || 'items not listed'} · ${Number(o.total || 0).toLocaleString()} ${o.currency || 'ETB'} · ${label[o.status] || o.status}${placed ? ` · placed ${placed}` : ''}`;
  }).join('\n');
}
