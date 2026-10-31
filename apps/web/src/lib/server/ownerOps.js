/**
 * Running the shop by talking to MiniMe: record sales and credit, take
 * payments, close orders, log expenses, see profit, edit products, run
 * promotions, tidy old work, and the morning brief. The rules live in
 * ownerLedger.mjs; this file does the reads and writes.
 *
 * Tools return either a string or { text, keyboard } (inline buttons).
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import {
  buildSale, stockAfterSale, saleRecordedText, orderRef, parseOrderRef, owedOn, isCredit,
  applyPayment, debtSummary, debtsText, debtReminderText, staleItems, ordersToExpire, tidyText,
  validateExpense, periodStart, profitText, promoFromArgs, promoText, promoAnnouncement,
  matchProduct, fmtMoney, briefText, briefKeyboard, shouldSendBrief,
} from './ownerLedger.mjs';

const cur = (b) => b?.currency || 'ETB';
const safeLike = (s) => String(s || '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 60);

async function invalidateProducts(businessId) {
  try { const { invalidateProductCache } = await import('./replyEngine'); invalidateProductCache(businessId); } catch {}
}

async function activeProducts(businessId) {
  const { data } = await supabase().from('products')
    .select('id, name, name_am, price, cost_price, currency, stock_quantity, low_stock_threshold, is_active')
    .eq('business_id', businessId).eq('is_active', true).limit(500);
  return data || [];
}

/** A customer by name or @handle, most recently active first. */
export async function findCustomer(businessId, who) {
  const q = safeLike(who);
  if (!q) return null;
  const handle = q.replace(/^@/, '');
  const { data } = await supabase().from('customers')
    .select('id, name, telegram_id, telegram_username, total_orders, total_spent')
    .eq('business_id', businessId)
    .or(`name.ilike.%${q}%,telegram_username.ilike.%${handle}%`)
    .order('last_active_at', { ascending: false, nullsFirst: false })
    .limit(1);
  return data?.[0] || null;
}

// ── record_sale ──────────────────────────────────────────────────────────────
export async function recordSale(business, args = {}) {
  const sb = supabase();
  const products = await activeProducts(business.id);
  const sale = buildSale({
    items: args.items, products, total: args.total,
    payment: args.payment, amountPaid: args.amount_paid,
  });
  if (!sale.ok) return sale.error;

  const who = String(args.customer || '').trim();
  const customer = who ? await findCustomer(business.id, who) : null;
  if (sale.credit && !who) return 'Who took it on credit? Tell me their name so I can track what they owe.';
  const now = new Date().toISOString();
  const meta = {
    recorded_by: 'owner_chat',
    customer_name: customer?.name || who || null,
    paid_amount: sale.paidAmount,
    payments: sale.paidAmount > 0 ? [{ amount: sale.paidAmount, at: now }] : [],
  };
  if (sale.credit) meta.credit = true;
  if (args.due_date && /^\d{4}-\d{2}-\d{2}$/.test(args.due_date)) meta.due_date = args.due_date;
  if (sale.total !== sale.subtotal) meta.discount_amount = Math.round((sale.subtotal - sale.total) * 100) / 100;

  const { data: order, error } = await sb.from('orders').insert({
    business_id: business.id,
    customer_id: customer?.id || null,
    items: sale.lines.map(l => ({ name: l.name, quantity: l.quantity, unit_price: l.unit_price, product_id: l.product_id })),
    subtotal: sale.subtotal, total: sale.total, currency: cur(business),
    status: sale.status, source: 'manual',
    payment_method: sale.credit ? 'credit' : (['cash', 'telebirr', 'cbe', 'bank', 'card'].includes(args.method) ? args.method : 'cash'),
    paid_at: sale.credit ? null : now,
    expires_at: null,
    owner_note: String(args.note || '').slice(0, 300) || null,
    meta,
  }).select('id').single();
  if (error || !order) return `❌ I couldn't save that sale (${String(error?.message || 'unknown').slice(0, 80)}).`;

  const changes = stockAfterSale(products, sale.lines);
  for (const c of changes) await sb.from('products').update({ stock_quantity: c.after }).eq('id', c.id);
  if (changes.length) {
    await invalidateProducts(business.id);
    // Undo puts back exactly what moved — untracked items never went down.
    await sb.from('orders').update({ meta: { ...meta, stock_moved: changes.map(c => ({ id: c.id, qty: c.before - c.after })) } }).eq('id', order.id);
  }
  if (customer) {
    await sb.from('customers').update({
      total_orders: (customer.total_orders || 0) + 1,
      total_spent: Number(customer.total_spent || 0) + sale.paidAmount,
      last_order_at: now,
    }).eq('id', customer.id).then(() => {}, () => {});
  }

  let text = saleRecordedText({ sale, customerName: meta.customer_name, stockChanges: changes, currency: cur(business), ref: orderRef(order.id) });
  if (who && !customer) text += `\n_${who} isn't in your customers yet — I saved the name on the sale._`;
  return { text, keyboard: [[{ text: '↩️ Undo', callback_data: `ops_undo_${order.id}` }]] };
}

/** Undo a sale recorded from chat: cancel it and put the stock back. */
export async function undoSale(business, orderId) {
  const sb = supabase();
  const { data: o } = await sb.from('orders').select('id, status, items, total, currency, meta, source')
    .eq('id', orderId).eq('business_id', business.id).maybeSingle();
  if (!o) return 'That sale is gone already.';
  if (o.source !== 'manual') return 'Only sales you recorded here can be undone.';
  if (o.status === 'cancelled') return 'Already undone.';
  await sb.from('orders').update({ status: 'cancelled', meta: { ...(o.meta || {}), undone_at: new Date().toISOString() } }).eq('id', o.id);
  const moved = (o.meta?.stock_moved || []).filter(m => m.id && m.qty > 0);
  if (moved.length) {
    const { data: ps } = await sb.from('products').select('id, stock_quantity').in('id', moved.map(m => m.id));
    for (const p of ps || []) {
      const qty = moved.filter(m => m.id === p.id).reduce((s, m) => s + m.qty, 0);
      await sb.from('products').update({ stock_quantity: Number(p.stock_quantity || 0) + qty }).eq('id', p.id);
    }
    await invalidateProducts(business.id);
  }
  return `↩️ Undone — the ${fmtMoney(o.total, o.currency)} sale is removed${moved.length ? ' and stock is back' : ''}.`;
}

// ── Orders: find one the owner means ─────────────────────────────────────────
async function openOrdersFor(business, whoOrRef) {
  const sb = supabase();
  const ref = parseOrderRef(whoOrRef);
  const base = () => sb.from('orders').select('id, status, total, currency, created_at, payment_method, meta, customer_id, source, customers(name, telegram_id)')
    .eq('business_id', business.id);
  if (ref) {
    const { data } = await base().in('status', ['pending_payment', 'paid']).order('created_at', { ascending: false }).limit(300);
    return (data || []).filter(o => o.id.replace(/-/g, '').startsWith(ref));
  }
  const who = safeLike(whoOrRef);
  if (!who) return [];
  const customer = await findCustomer(business.id, who);
  const { data } = customer
    ? await base().eq('customer_id', customer.id).in('status', ['pending_payment', 'paid']).order('created_at', { ascending: true }).limit(50)
    : await base().is('customer_id', null).ilike('meta->>customer_name', `%${who}%`).in('status', ['pending_payment', 'paid']).order('created_at', { ascending: true }).limit(50);
  return data || [];
}

// ── customer_paid ────────────────────────────────────────────────────────────
export async function customerPaid(business, args = {}) {
  const who = String(args.who || '').trim();
  if (!who) return 'Who paid? e.g. "Abebe paid 500".';
  const orders = (await openOrdersFor(business, who)).filter(o => o.status === 'pending_payment');
  if (!orders.length) return `I don't see anything unpaid for *${who}*. Check /debts or /orders.`;
  const amount = args.amount == null || args.amount === '' ? null : Number(String(args.amount).replace(/,/g, ''));
  if (amount != null && !(amount > 0)) return 'How much did they pay?';
  const { updates, applied, leftover } = applyPayment(orders, amount);
  const sb = supabase();
  const now = new Date().toISOString();
  for (const u of updates) {
    const o = orders.find(x => x.id === u.id);
    const meta = { ...(o.meta || {}), paid_amount: u.paid_amount, payments: [...(o.meta?.payments || []), { amount: u.pay, at: now, method: args.method || null }] };
    await sb.from('orders').update(u.fully ? { status: 'paid', paid_at: now, meta } : { meta }).eq('id', u.id);
  }
  const name = orders[0].customers?.name || orders[0].meta?.customer_name || who;
  const still = orders.reduce((s, o) => s + owedOn(o), 0) - applied;
  const lines = [`✅ *${name}* paid ${fmtMoney(applied, cur(business))}.`];
  lines.push(still > 0.009 ? `💸 Still owes *${fmtMoney(still, cur(business))}*.` : '🎉 All settled — they owe nothing now.');
  if (leftover > 0) lines.push(`_${fmtMoney(leftover, cur(business))} more than they owed — I didn't record the extra._`);
  return lines.join('\n');
}

// ── update_order ─────────────────────────────────────────────────────────────
export async function updateOrder(business, args = {}) {
  const action = args.action;
  if (!['delivered', 'cancelled', 'paid'].includes(action)) return 'Should I mark it paid, delivered or cancelled?';
  if (action === 'paid') return customerPaid(business, { who: args.order, amount: null });
  const orders = await openOrdersFor(business, args.order);
  const pick = action === 'delivered'
    ? orders.filter(o => o.status === 'paid' || isCredit(o))
    : orders.filter(o => o.status === 'pending_payment');
  if (!pick.length) return `I couldn't find an open order for *${args.order}*. Try the ref from /orders, e.g. "#AB12CD34".`;
  if (pick.length > 1 && !parseOrderRef(args.order)) {
    const list = pick.slice(-5).map(o => `• #${orderRef(o.id)} — ${fmtMoney(o.total, o.currency)} · ${o.created_at.slice(0, 10)}`).join('\n');
    return `*${pick[0].customers?.name || args.order}* has ${pick.length} open orders. Which one?\n${list}\n\n_Say e.g. "${action === 'delivered' ? 'delivered' : 'cancel'} #${orderRef(pick[pick.length - 1].id)}"._`;
  }
  const o = pick[pick.length - 1];
  const sb = supabase();
  if (action === 'delivered') {
    await sb.from('orders').update(o.status === 'paid'
      ? { status: 'fulfilled', fulfilled_at: new Date().toISOString() }
      : { fulfilled_at: new Date().toISOString(), meta: { ...(o.meta || {}), delivered_at: new Date().toISOString() } }).eq('id', o.id);
    return `📦 Marked delivered — #${orderRef(o.id)}, ${fmtMoney(o.total, o.currency)}${isCredit(o) && owedOn(o) > 0 ? ` (still ${fmtMoney(owedOn(o), o.currency)} owed)` : ''}.`;
  }
  await sb.from('orders').update({ status: 'cancelled' }).eq('id', o.id);
  return `✗ Cancelled #${orderRef(o.id)} — ${fmtMoney(o.total, o.currency)}. I won't chase it.`;
}

// ── list_debts ───────────────────────────────────────────────────────────────
async function openCredit(businessId) {
  const { data } = await supabase().from('orders')
    .select('id, total, currency, created_at, meta, customer_id, payment_method, customers(name, telegram_id)')
    .eq('business_id', businessId).eq('status', 'pending_payment').eq('payment_method', 'credit')
    .order('created_at', { ascending: true }).limit(500);
  return data || [];
}

export async function listDebts(business) {
  const debts = debtSummary(await openCredit(business.id));
  const text = debtsText(debts, cur(business));
  const remindable = debts.filter(d => d.customerId && d.telegramId).slice(0, 6);
  const keyboard = remindable.map(d => [{ text: `📨 Remind ${String(d.name).slice(0, 20)}`, callback_data: `ops_remind_${d.customerId}` }]);
  return keyboard.length ? { text, keyboard } : text;
}

async function remindDebtor(token, business, customerId) {
  const debts = debtSummary(await openCredit(business.id)).filter(d => d.customerId === customerId);
  const d = debts[0];
  if (!d) return 'They have nothing open anymore. 🎉';
  const msg = debtReminderText({ businessName: business.name, name: d.name, owed: d.owed, currency: cur(business) });
  const r = d.telegramId ? await tg(token, 'sendMessage', { chat_id: d.telegramId, text: msg }).catch(() => null) : null;
  if (r?.ok) return `📨 Reminder sent to *${d.name}* (${fmtMoney(d.owed, cur(business))}).`;
  return `I couldn't message *${d.name}* from here. Forward this to them:\n\n${msg}`;
}

// ── Expenses and profit ──────────────────────────────────────────────────────
export async function recordExpense(business, args = {}) {
  const v = validateExpense(args);
  if (!v.ok) return v.error;
  let spentAt = new Date();
  if (args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) spentAt = new Date(`${args.date}T12:00:00+03:00`);
  const { error } = await supabase().from('business_expenses').insert({
    business_id: business.id, ...v.expense, currency: cur(business), spent_at: spentAt.toISOString(),
  });
  if (error) {
    if (/business_expenses/.test(error.message)) return '⚠️ Expense tracking is being switched on — try again in a little while.';
    return `❌ Couldn't save that expense (${error.message.slice(0, 80)}).`;
  }
  return `🧾 Saved: ${fmtMoney(v.expense.amount, cur(business))} — ${v.expense.category}${v.expense.note ? ` (${v.expense.note})` : ''}. Ask "how much did I make this month?" any time.`;
}

export async function profitSummary(business, args = {}) {
  const period = ['today', 'week', 'month'].includes(args.period) ? args.period : 'month';
  const since = periodStart(period).toISOString();
  const sb = supabase();
  const [{ data: sales }, expRes, credit, products] = await Promise.all([
    sb.from('orders').select('total, items').eq('business_id', business.id).in('status', ['paid', 'fulfilled']).gte('paid_at', since).limit(2000),
    sb.from('business_expenses').select('amount, category').eq('business_id', business.id).gte('spent_at', since).limit(2000),
    openCredit(business.id),
    activeProducts(business.id),
  ]);
  const revenue = (sales || []).reduce((s, o) => s + Number(o.total || 0), 0);
  // Cost of goods only when every sold item has a cost price, so the number is never half-true.
  let cogs = 0, known = true;
  for (const o of sales || []) for (const it of o.items || []) {
    const p = (it.product_id && products.find(x => x.id === it.product_id)) || matchProduct(products, it.name);
    if (p?.cost_price == null) { known = false; break; }
    cogs += Number(p.cost_price) * Number(it.quantity || 1);
  }
  return profitText({
    period, revenue, salesCount: (sales || []).length,
    cogs: known && sales?.length ? cogs : null,
    expenses: expRes.error ? [] : (expRes.data || []),
    owed: credit.reduce((s, o) => s + owedOn(o), 0),
    currency: cur(business),
  });
}

// ── Products ─────────────────────────────────────────────────────────────────
export async function editProduct(business, args = {}) {
  const sb = supabase();
  const { data: all } = await sb.from('products').select('id, name, name_am, price, description, is_active, cost_price')
    .eq('business_id', business.id).limit(500);
  const pool = args.action === 'restore' ? (all || []).filter(p => !p.is_active) : (all || []).filter(p => p.is_active);
  const p = matchProduct(pool, args.product_name);
  if (!p) return `I couldn't find *${args.product_name}* in your ${args.action === 'restore' ? 'removed ' : ''}catalog. Say /stock to see it.`;
  let patch, said;
  switch (args.action) {
    case 'remove': patch = { is_active: false }; said = `🗑 *${p.name}* removed — customers won't be offered it. Say "bring back ${p.name}" to restore it.`; break;
    case 'restore': patch = { is_active: true }; said = `✅ *${p.name}* is back in your catalog.`; break;
    case 'rename': {
      const n = String(args.new_name || '').trim().slice(0, 120);
      if (n.length < 2) return 'What should the new name be?';
      patch = { name: n }; said = `✏️ *${p.name}* is now *${n}*.`; break;
    }
    case 'describe': {
      const d = String(args.description || '').trim().slice(0, 500);
      if (!d) return 'What should the description say?';
      patch = { description: d }; said = `📝 Description saved for *${p.name}*. I'll use it when customers ask.`; break;
    }
    case 'cost': {
      const c = Number(String(args.cost_price ?? '').replace(/,/g, ''));
      if (!(c >= 0)) return 'What does one cost you?';
      patch = { cost_price: c }; said = `💡 *${p.name}* costs you ${fmtMoney(c, cur(business))}${p.price ? ` — about ${fmtMoney(Number(p.price) - c, cur(business))} profit each` : ''}.`; break;
    }
    default: return 'Do you want to remove, rename, describe, restore or set the cost of a product?';
  }
  const { error } = await sb.from('products').update(patch).eq('id', p.id);
  if (error) return `❌ Couldn't update *${p.name}* (${error.message.slice(0, 80)}).`;
  await invalidateProducts(business.id);
  return said;
}

// ── Promotions ───────────────────────────────────────────────────────────────
export async function createPromotion(business, args = {}) {
  const v = promoFromArgs(args);
  if (!v.ok) return v.error;
  const sb = supabase();
  const { data: clash } = await sb.from('discounts').select('id').eq('business_id', business.id).ilike('code', v.promo.code).eq('is_active', true).limit(1);
  if (clash?.length) v.promo.code = `${v.promo.code.slice(0, 12)}${Math.floor(Math.random() * 90 + 10)}`;
  const { error } = await sb.from('discounts').insert({ business_id: business.id, ...v.promo });
  if (error) return `❌ Couldn't create the promotion (${error.message.slice(0, 80)}).`;
  const announce = promoAnnouncement(v.promo, business.name, cur(business));
  return `${promoText(v.promo, cur(business))}\n\nWant me to tell your customers? Say *"announce it to my regulars"* (or "everyone") and I'll show you the message first:\n_${announce}_`;
}

// ── Stale work ───────────────────────────────────────────────────────────────
async function loadOpenWork(businessId) {
  const sb = supabase();
  const [{ data: orders }, { data: jobs }] = await Promise.all([
    sb.from('orders').select('id, status, total, currency, created_at, payment_method, meta, customers(name)')
      .eq('business_id', businessId).eq('status', 'pending_payment').order('created_at', { ascending: true }).limit(300),
    sb.from('jobs').select('id, title, status, created_at, updated_at, payload, customers(name)')
      .eq('business_id', businessId).in('status', ['draft', 'active', 'awaiting_approval', 'blocked']).limit(300),
  ]);
  return { orders: orders || [], jobs: jobs || [] };
}

export async function tidyUp(business) {
  const stale = staleItems(await loadOpenWork(business.id));
  const text = tidyText(stale, cur(business));
  if (!stale.orders.length && !stale.jobs.length) return text;
  return { text, keyboard: [[{ text: `🧹 Close all ${stale.orders.length + stale.jobs.length}`, callback_data: 'ops_tidy_close' }, { text: 'Keep them', callback_data: 'ops_tidy_keep' }]] };
}

export async function closeStale(business) {
  const stale = staleItems(await loadOpenWork(business.id));
  const sb = supabase();
  const at = new Date().toISOString();
  if (stale.orders.length) await sb.from('orders').update({ status: 'expired' }).in('id', stale.orders.map(o => o.id));
  for (const j of stale.jobs) {
    await sb.from('jobs').update({ status: 'cancelled', payload: { ...(j.payload || {}), closed_as_stale_at: at } }).eq('id', j.id);
  }
  return `🧹 Closed ${stale.orders.length} old order${stale.orders.length === 1 ? '' : 's'} and ${stale.jobs.length} job${stale.jobs.length === 1 ? '' : 's'}. /orders and the advisor now show only real work.`;
}

/** Cron: unpaid non-credit orders a month old are dead — expire them quietly. */
export async function expireOldOrders() {
  const sb = supabase();
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await sb.from('orders').select('id, status, created_at, payment_method, meta')
    .eq('status', 'pending_payment').lt('created_at', cutoff).limit(1000);
  const ids = ordersToExpire(data || []).map(o => o.id);
  if (ids.length) await sb.from('orders').update({ status: 'expired' }).in('id', ids);
  return ids.length;
}

// ── Morning brief ────────────────────────────────────────────────────────────
export async function briefStats(business, now = new Date()) {
  const sb = supabase();
  const todayStart = periodStart('today', now);
  const ydayStart = new Date(todayStart.getTime() - 86400000).toISOString();
  const tStart = todayStart.toISOString();
  const [msgs, drafts, sales, expRes, unpaid, credit, products, work] = await Promise.all([
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('business_id', business.id).eq('direction', 'inbound').gte('created_at', ydayStart).lt('created_at', tStart),
    sb.from('conversations').select('id', { count: 'exact', head: true }).eq('business_id', business.id).eq('requires_owner', true).eq('status', 'active'),
    sb.from('orders').select('total').eq('business_id', business.id).in('status', ['paid', 'fulfilled']).gte('paid_at', ydayStart).lt('paid_at', tStart),
    sb.from('business_expenses').select('amount').eq('business_id', business.id).gte('spent_at', ydayStart).lt('spent_at', tStart),
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('business_id', business.id).eq('status', 'pending_payment').neq('payment_method', 'credit').gte('created_at', new Date(now - 7 * 86400000).toISOString()),
    openCredit(business.id),
    activeProducts(business.id),
    loadOpenWork(business.id),
  ]);
  const { prunePending } = await import('./contactRules.mjs');
  const waiting = Object.keys(prunePending(business.notification_prefs?.pending_contacts) || {}).length;
  const debts = debtSummary(credit, now);
  const today = new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
  const stale = staleItems(work, now);
  return {
    messages: msgs.count || 0,
    drafts: drafts.count || 0,
    waiting,
    revenue: (sales.data || []).reduce((s, o) => s + Number(o.total || 0), 0),
    expenses: expRes.error ? 0 : (expRes.data || []).reduce((s, e) => s + Number(e.amount || 0), 0),
    unpaid: unpaid.count || 0,
    debtors: debts.length,
    owed: debts.reduce((s, d) => s + d.owed, 0),
    overdue: debts.filter(d => d.dueDate && d.dueDate < today).length,
    // Stock 0 is the default for untracked items, so only count items that still have some.
    lowStock: products.filter(p => Number(p.stock_quantity ?? 0) > 0 && Number(p.stock_quantity) <= Number(p.low_stock_threshold ?? 10)).length,
    stale: stale.orders.length + stale.jobs.length,
  };
}

/** Build (and maybe send) one owner's brief. Returns { sent, reason }. */
export async function sendMorningBrief({ token, business, chatId, activeRecently, now = new Date() }) {
  const cfg = business.notification_prefs?.morning_summary;
  if (cfg?.enabled === false) return { sent: false, reason: 'off' };
  const stats = await briefStats(business, now);
  if (!shouldSendBrief(cfg, stats, { activeRecently })) return { sent: false, reason: 'nothing_to_act_on' };
  const hour = new Date(now.getTime() + 3 * 3600000).getUTCHours();
  const text = briefText(stats, { businessName: business.name, ownerFirst: (business.owner_name || '').split(' ')[0], hour, currency: cur(business) });
  const { sendMarkdownSafe } = await import('./tgEscape.mjs');
  const r = await sendMarkdownSafe(b => tg(token, 'sendMessage', b), {
    chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true,
    reply_markup: { inline_keyboard: briefKeyboard(stats) },
  });
  return { sent: !!r?.ok, reason: r?.ok ? 'ok' : (r?.description || 'send_failed'), stats };
}

async function setBriefEnabled(business, enabled) {
  const sb = supabase();
  const { data } = await sb.from('businesses').select('notification_prefs').eq('id', business.id).single();
  const prefs = data?.notification_prefs || {};
  prefs.morning_summary = { ...(prefs.morning_summary || {}), enabled };
  await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', business.id);
}

// ── Buttons ──────────────────────────────────────────────────────────────────
/**
 * Owner taps on ops_* buttons. The caller checks the tapper is the owner.
 * Returns true when handled.
 */
export async function handleOpsCallback({ token, business, chatId, msgId, data, answer }) {
  if (!data?.startsWith('ops_')) return false;
  const { sendMarkdownSafe } = await import('./tgEscape.mjs');
  const send = async (out) => {
    const o = typeof out === 'string' ? { text: out } : out;
    await sendMarkdownSafe(b => tg(token, 'sendMessage', b), {
      chat_id: chatId, text: o.text, parse_mode: 'Markdown', disable_web_page_preview: true,
      reply_markup: o.keyboard ? { inline_keyboard: o.keyboard } : undefined,
    });
  };
  const clearButtons = () => tg(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }).catch(() => {});

  if (data === 'ops_debts') { await answer('💸'); await send(await listDebts(business)); return true; }
  if (data === 'ops_profit') { await answer('📊'); await send(await profitSummary(business, { period: 'month' })); return true; }
  if (data === 'ops_tidy') { await answer('🧹'); await send(await tidyUp(business)); return true; }
  if (data === 'ops_stock') {
    await answer('📦');
    const { listOwnerStock } = await import('./ownerCommands');
    await send(await listOwnerStock(business.id));
    return true;
  }
  if (data === 'ops_tidy_close') { await clearButtons(); await answer('Closed'); await send(await closeStale(business)); return true; }
  if (data === 'ops_tidy_keep') { await clearButtons(); await answer('Kept'); await send('👍 Kept them. Tell me any time an order or job is done or dead and I\'ll close it.'); return true; }
  if (data === 'ops_brief_off') { await setBriefEnabled(business, false); await clearButtons(); await answer('Stopped'); await send('🔕 Daily brief stopped. Say "turn on my morning brief" to bring it back.'); return true; }
  if (data.startsWith('ops_undo_')) { await clearButtons(); await answer('↩️'); await send(await undoSale(business, data.slice('ops_undo_'.length))); return true; }
  if (data.startsWith('ops_remind_')) { await answer('📨'); await send(await remindDebtor(token, business, data.slice('ops_remind_'.length))); return true; }
  await answer('');
  return true;
}

export async function setMorningBrief(business, enabled) {
  await setBriefEnabled(business, !!enabled);
  return enabled
    ? '☀️ Morning brief is on — every day around 8am: what sold, who owes you, who\'s waiting and what\'s running low.'
    : '🔕 Morning brief is off.';
}
