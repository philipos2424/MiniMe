/**
 * The owner's books, kept by talking (pure, no I/O).
 *
 * Owners sell in chat, in person and on credit. None of that reached MiniMe:
 * the owner agent could not record a sale, so /sales, the advisor and the
 * morning brief only ever saw the rare order placed through the bot (2 in
 * 120 days across all shops). Old unpaid orders and untouched jobs piled up
 * for months and the advisor treated them as live work. This module holds the
 * rules for recording sales, credit ("who owes me"), payments, expenses,
 * promotions, stale-item cleanup and the morning brief, so the I/O layer
 * (ownerOps.js) stays thin and all of it is testable.
 */

const EAT_MS = 3 * 3600 * 1000;
const DAY = 86400000;

export const fmtMoney = (n, currency = 'ETB') => `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;

/** Short, speakable order reference: first 8 hex chars, upper-case. */
export const orderRef = (id) => String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();

/** An 8-hex reference written by the owner ("#AB12CD34", "ab12cd34"), or null. */
export function parseOrderRef(text) {
  const m = String(text || '').match(/#?\b([0-9a-f]{8})\b/i);
  return m ? m[1].toLowerCase() : null;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Best catalog match for what the owner called it. Exact name, then one name
 * containing the other, then most shared words. Amharic names count too.
 */
export function matchProduct(products, query) {
  const q = norm(query);
  if (!q || !Array.isArray(products) || !products.length) return null;
  const names = (p) => [norm(p.name), norm(p.name_am)].filter(Boolean);
  let hit = products.find(p => names(p).includes(q));
  if (hit) return hit;
  hit = products.find(p => names(p).some(n => n.includes(q) || q.includes(n)));
  if (hit) return hit;
  const qw = new Set(q.split(' ').filter(w => w.length > 1));
  let best = null, bestScore = 0;
  for (const p of products) {
    for (const n of names(p)) {
      const score = n.split(' ').filter(w => qw.has(w)).length;
      if (score > bestScore) { best = p; bestScore = score; }
    }
  }
  return bestScore > 0 ? best : null;
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Turn the owner's words into a sale.
 * items: [{ name, quantity?, unit_price? }]; total overrides the sum (a discount);
 * payment: 'paid' (default) | 'credit' | 'partial' with amount_paid.
 * Returns { ok, lines, subtotal, total, paidAmount, status, credit } or { ok:false, error }.
 */
export function buildSale({ items, products = [], total, payment = 'paid', amountPaid } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(i => i && String(i.name || '').trim());
  if (!list.length) return { ok: false, error: 'What did you sell? e.g. "sold 2 coffee 1kg to Abebe, cash".' };
  if (list.length > 30) return { ok: false, error: 'That is a lot of items for one sale — split it into a few messages.' };
  const givenTotal = num(total);
  const lines = [];
  for (const it of list) {
    const qty = num(it.quantity) ?? 1;
    if (!(qty > 0) || qty > 100000 || !Number.isInteger(qty)) return { ok: false, error: `How many *${String(it.name).trim()}*? Use a whole number.` };
    const product = matchProduct(products, it.name);
    let unit = num(it.unit_price);
    if (unit == null && product?.price != null) unit = Number(product.price);
    if (unit == null && list.length === 1 && givenTotal != null) unit = givenTotal / qty;
    if (unit == null || unit < 0) return { ok: false, error: `What price did *${String(it.name).trim()}* sell for? It isn't in your catalog with a price.` };
    lines.push({
      name: product?.name || String(it.name).trim().slice(0, 120),
      quantity: qty,
      unit_price: Math.round(unit * 100) / 100,
      line_total: Math.round(unit * qty * 100) / 100,
      product_id: product?.id || null,
    });
  }
  const subtotal = Math.round(lines.reduce((s, l) => s + l.line_total, 0) * 100) / 100;
  const finalTotal = givenTotal != null && givenTotal >= 0 ? givenTotal : subtotal;
  if (!(finalTotal > 0)) return { ok: false, error: 'The total came to 0 — what was the price?' };

  let mode = ['credit', 'partial', 'paid'].includes(payment) ? payment : 'paid';
  let paidAmount = finalTotal;
  if (mode === 'credit') paidAmount = 0;
  if (mode === 'partial') {
    const a = num(amountPaid);
    if (a == null || a < 0) return { ok: false, error: 'How much did they pay now?' };
    if (a >= finalTotal) mode = 'paid';
    else paidAmount = a;
  }
  if (mode === 'paid') paidAmount = finalTotal;
  const credit = mode !== 'paid';
  return { ok: true, lines, subtotal, total: finalTotal, paidAmount, credit, status: credit ? 'pending_payment' : 'paid' };
}

/** Stock after a sale: tracked items go down (never below 0); untracked (0/null) stay. */
export function stockAfterSale(products, lines) {
  const changes = [];
  const byId = new Map((products || []).map(p => [p.id, p]));
  for (const l of lines || []) {
    const p = l.product_id && byId.get(l.product_id);
    if (!p) continue;
    const before = Number(p.stock_quantity ?? 0);
    if (!(before > 0)) continue; // not tracked — don't invent a negative count
    const after = Math.max(0, before - l.quantity);
    changes.push({ id: p.id, name: p.name, before, after, low: after <= Number(p.low_stock_threshold ?? 10) });
  }
  return changes;
}

const itemsLine = (lines, currency) => lines.map(l => `${l.quantity}× ${l.name}${l.quantity > 1 || lines.length > 1 ? ` (${fmtMoney(l.line_total, currency)})` : ''}`).join(', ');

export function saleRecordedText({ sale, customerName, stockChanges = [], currency = 'ETB', ref }) {
  const who = customerName ? ` to *${customerName}*` : '';
  const out = [`✅ *Sale recorded*${who} — ${fmtMoney(sale.total, currency)}`, itemsLine(sale.lines, currency)];
  if (sale.credit) {
    const owed = sale.total - sale.paidAmount;
    out.push(sale.paidAmount > 0
      ? `💸 Paid ${fmtMoney(sale.paidAmount, currency)} now · *${fmtMoney(owed, currency)} still owed*`
      : `💸 On credit — *${fmtMoney(owed, currency)} owed*`);
  }
  for (const c of stockChanges) out.push(`📦 ${c.name}: ${c.before} → *${c.after}* left${c.after === 0 ? ' — sold out' : c.low ? ' — running low' : ''}`);
  if (ref) out.push(`_Ref ${ref}. Counts in /sales._`);
  return out.join('\n');
}

/** What is still owed on an order. */
export function owedOn(order) {
  const paid = Number(order?.meta?.paid_amount ?? 0);
  return Math.max(0, Math.round((Number(order?.total || 0) - paid) * 100) / 100);
}

export const isCredit = (o) => o?.payment_method === 'credit' || o?.meta?.credit === true;

/**
 * Spread a payment over a customer's open orders, oldest first.
 * amount null/undefined = pay everything off.
 * Returns { updates: [{ id, paid_amount, fully }], applied, leftover }.
 */
export function applyPayment(orders, amount) {
  const open = (orders || []).filter(o => owedOn(o) > 0)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let left = amount == null ? Infinity : Math.max(0, Number(amount) || 0);
  const updates = [];
  let applied = 0;
  for (const o of open) {
    if (!(left > 0)) break;
    const owed = owedOn(o);
    const pay = Math.min(owed, left);
    const paidSoFar = Number(o.meta?.paid_amount ?? 0);
    updates.push({ id: o.id, paid_amount: Math.round((paidSoFar + pay) * 100) / 100, fully: pay >= owed, pay });
    applied += pay;
    left -= pay;
  }
  return { updates, applied: Math.round(applied * 100) / 100, leftover: left === Infinity ? 0 : Math.round(left * 100) / 100 };
}

const custName = (o) => o?.customers?.name || o?.meta?.customer_name || 'Unnamed customer';

/** Group open credit by person, biggest first. */
export function debtSummary(orders, now = new Date()) {
  const by = new Map();
  for (const o of orders || []) {
    const owed = owedOn(o);
    if (!(owed > 0)) continue;
    const key = o.customer_id || `name:${norm(custName(o))}`;
    const cur = by.get(key) || { key, customerId: o.customer_id || null, name: custName(o), owed: 0, count: 0, oldest: o.created_at, telegramId: o.customers?.telegram_id || null, dueDate: null };
    cur.owed = Math.round((cur.owed + owed) * 100) / 100;
    cur.count += 1;
    if (new Date(o.created_at) < new Date(cur.oldest)) cur.oldest = o.created_at;
    const due = o.meta?.due_date;
    if (due && (!cur.dueDate || due < cur.dueDate)) cur.dueDate = due;
    by.set(key, cur);
  }
  return [...by.values()].map(d => ({ ...d, days: Math.max(0, Math.floor((now - new Date(d.oldest)) / DAY)) }))
    .sort((a, b) => b.owed - a.owed);
}

export function debtsText(debts, currency = 'ETB', now = new Date()) {
  if (!debts.length) return '✅ *Nobody owes you money.*\n\nWhen you sell on credit, tell me — e.g. "Abebe took 2 coffee, will pay Friday" — and I\'ll track it.';
  const total = debts.reduce((s, d) => s + d.owed, 0);
  const today = new Date(now.getTime() + EAT_MS).toISOString().slice(0, 10);
  const lines = [`💸 *Who owes you* — ${fmtMoney(total, currency)} total`, ''];
  debts.slice(0, 20).forEach((d, i) => {
    const late = d.dueDate && d.dueDate < today ? ' · ⚠️ overdue' : d.dueDate ? ` · due ${d.dueDate}` : '';
    lines.push(`${i + 1}. *${d.name}* — ${fmtMoney(d.owed, currency)}${d.count > 1 ? ` (${d.count} sales)` : ''} · ${d.days === 0 ? 'today' : `${d.days}d ago`}${late}`);
  });
  if (debts.length > 20) lines.push(`_…and ${debts.length - 20} more_`);
  lines.push('', '_When someone pays, tell me: "Abebe paid 500"._');
  return lines.join('\n');
}

/** Polite reminder the owner approves before it goes to the customer. */
export function debtReminderText({ businessName, name, owed, currency = 'ETB' }) {
  const first = String(name || '').split(' ')[0];
  return `Hi${first ? ` ${first}` : ''} 👋 A friendly reminder from ${businessName}: ${fmtMoney(owed, currency)} is still open on your account. Whenever it suits you — thank you! 🙏\n\nሰላም! ከ${businessName} ትንሽ ማስታወሻ፦ ${fmtMoney(owed, currency)} ቀሪ ሂሳብ አለ። ስለ ትብብርዎ እናመሰግናለን 🙏`;
}

// ── Stale work ───────────────────────────────────────────────────────────────
export const STALE_ORDER_DAYS = 7;   // unpaid (not credit) orders: the buyer has moved on
export const STALE_JOB_DAYS = 21;    // jobs nobody touched in three weeks
export const EXPIRE_ORDER_DAYS = 30; // unpaid non-credit orders this old are expired automatically

const OPEN_JOB = ['draft', 'active', 'awaiting_approval', 'blocked'];

export function staleItems({ orders = [], jobs = [] }, now = new Date()) {
  const age = (t) => (now - new Date(t)) / DAY;
  return {
    orders: orders.filter(o => o.status === 'pending_payment' && !isCredit(o) && age(o.created_at) >= STALE_ORDER_DAYS),
    jobs: jobs.filter(j => OPEN_JOB.includes(j.status) && age(j.updated_at || j.created_at) >= STALE_JOB_DAYS),
  };
}

/** Unpaid, non-credit orders old enough to expire without asking. */
export function ordersToExpire(orders, now = new Date()) {
  return (orders || []).filter(o => o.status === 'pending_payment' && !isCredit(o) && (now - new Date(o.created_at)) / DAY >= EXPIRE_ORDER_DAYS);
}

export function tidyText(stale, currency = 'ETB') {
  const n = stale.orders.length + stale.jobs.length;
  if (!n) return '✨ *Nothing old to tidy* — your orders and jobs are all current.';
  const lines = [`🧹 *${n} old item${n === 1 ? '' : 's'} still look open*`, ''];
  if (stale.orders.length) {
    lines.push(`*Unpaid orders (${stale.orders.length})*`);
    for (const o of stale.orders.slice(0, 8)) lines.push(`• ${custName(o)} — ${fmtMoney(o.total, o.currency || currency)} · ${new Date(o.created_at).toISOString().slice(0, 10)}`);
    if (stale.orders.length > 8) lines.push(`  _…and ${stale.orders.length - 8} more_`);
  }
  if (stale.jobs.length) {
    lines.push(`*Jobs nobody touched in ${STALE_JOB_DAYS}+ days (${stale.jobs.length})*`);
    for (const j of stale.jobs.slice(0, 8)) lines.push(`• ${String(j.title || 'Job').slice(0, 60)}${j.customers?.name ? ` — ${j.customers.name}` : ''}`);
    if (stale.jobs.length > 8) lines.push(`  _…and ${stale.jobs.length - 8} more_`);
  }
  lines.push('', '_Close them so your orders, advisor and brief show only real work. Anything still going, tell me and I\'ll keep it._');
  return lines.join('\n');
}

// ── Expenses and profit ─────────────────────────────────────────────────────
export const EXPENSE_CATEGORIES = ['stock', 'rent', 'salary', 'transport', 'utilities', 'marketing', 'fees', 'other'];

export function validateExpense(args = {}) {
  const amount = num(args.amount);
  if (!(amount > 0)) return { ok: false, error: 'How much was it? e.g. "paid 3,000 rent".' };
  if (amount > 100000000) return { ok: false, error: 'That amount looks too big — check the number.' };
  const raw = norm(args.category);
  const category = EXPENSE_CATEGORIES.includes(raw) ? raw : 'other';
  const note = String(args.note || '').trim().slice(0, 200) || null;
  return { ok: true, expense: { amount, category, note } };
}

/** Start of today / this week (Mon) / this month in Ethiopia time, as a UTC Date. */
export function periodStart(period, now = new Date()) {
  const local = new Date(now.getTime() + EAT_MS);
  local.setUTCHours(0, 0, 0, 0);
  if (period === 'week') local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  else if (period === 'month') local.setUTCDate(1);
  return new Date(local.getTime() - EAT_MS);
}

const PERIOD_LABEL = { today: 'Today', week: 'This week', month: 'This month' };

export function profitText({ period = 'month', revenue = 0, salesCount = 0, cogs = null, expenses = [], owed = 0, currency = 'ETB' }) {
  const spent = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const profit = revenue - (cogs || 0) - spent;
  const lines = [`📊 *${PERIOD_LABEL[period] || 'This month'}*`, ''];
  lines.push(`💰 Money in: *${fmtMoney(revenue, currency)}* (${salesCount} sale${salesCount === 1 ? '' : 's'})`);
  if (cogs) lines.push(`📦 Cost of goods sold: ${fmtMoney(cogs, currency)}`);
  lines.push(`🧾 Expenses: ${fmtMoney(spent, currency)}`);
  if (expenses.length) {
    const by = {};
    for (const e of expenses) by[e.category || 'other'] = (by[e.category || 'other'] || 0) + Number(e.amount || 0);
    for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6)) lines.push(`   • ${k}: ${fmtMoney(v, currency)}`);
  }
  lines.push(`${profit >= 0 ? '✅' : '🔻'} *${profit >= 0 ? 'Profit' : 'Loss'}: ${fmtMoney(Math.abs(profit), currency)}*`);
  if (owed > 0) lines.push(`💸 Still owed to you: ${fmtMoney(owed, currency)} (not counted until paid)`);
  if (!revenue && !spent) lines.push('', '_Nothing recorded yet. Tell me sales ("sold 3 shirts 1,200 each") and costs ("paid 2,000 transport") as they happen._');
  else if (cogs == null && revenue) lines.push('', '_Add cost prices to your products to see true profit per item._');
  return lines.join('\n');
}

/**
 * Money that came in during a period. Sales recorded in chat keep a payments
 * list, so a credit sale paid in parts counts each part when it was paid (a
 * 3,000 deposit on an 8,000 credit sale is 3,000 of income today). Bot orders
 * count their total when they were paid.
 */
export function revenueInPeriod(orders, since) {
  const from = new Date(since).getTime();
  let revenue = 0, sales = 0;
  for (const o of orders || []) {
    if (o.status === 'cancelled' || o.status === 'refunded' || o.status === 'expired') continue;
    let got = 0;
    if (Array.isArray(o.meta?.payments)) {
      for (const p of o.meta.payments) if (new Date(p.at).getTime() >= from) got += Number(p.amount || 0);
    } else if ((o.status === 'paid' || o.status === 'fulfilled') && o.paid_at && new Date(o.paid_at).getTime() >= from) {
      got = Number(o.total || 0);
    }
    if (got > 0) { revenue += got; sales += 1; }
  }
  return { revenue: Math.round(revenue * 100) / 100, sales };
}

// ── Promotions ──────────────────────────────────────────────────────────────
export function promoFromArgs(args = {}, now = new Date()) {
  const percent = num(args.percent_off);
  const amountOff = num(args.amount_off);
  if (percent == null && amountOff == null) return { ok: false, error: 'How big is the discount? e.g. "10% off" or "100 birr off".' };
  if (percent != null && !(percent > 0 && percent <= 90)) return { ok: false, error: 'Percent off must be between 1 and 90.' };
  if (amountOff != null && !(amountOff > 0)) return { ok: false, error: 'The amount off must be more than 0.' };
  let code = String(args.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (code.length < 3) code = `SAVE${percent != null ? Math.round(percent) : Math.round(amountOff)}`;
  let expires_at = null;
  if (args.ends_iso) {
    const d = new Date(/T/.test(args.ends_iso) ? args.ends_iso : `${args.ends_iso}T23:59:00+03:00`);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "I couldn't read the end date." };
    if (d <= now) return { ok: false, error: 'That end date is already past.' };
    expires_at = d.toISOString();
  }
  const min = num(args.min_order);
  const maxUses = num(args.max_uses);
  return {
    ok: true,
    promo: {
      code, type: percent != null ? 'percent' : 'fixed', value: percent != null ? percent : amountOff,
      expires_at, min_order: min > 0 ? min : null, max_uses: maxUses > 0 ? Math.floor(maxUses) : null, is_active: true,
    },
  };
}

export function promoText(p, currency = 'ETB') {
  const what = p.type === 'percent' ? `${p.value}% off` : `${fmtMoney(p.value, currency)} off`;
  const bits = [`🎉 *Promotion live:* ${what} with code *${p.code}*`];
  if (p.expires_at) bits.push(`Ends ${new Date(new Date(p.expires_at).getTime() + EAT_MS).toISOString().slice(0, 16).replace('T', ' ')}`);
  if (p.min_order) bits.push(`Min order ${fmtMoney(p.min_order, currency)}`);
  if (p.max_uses) bits.push(`First ${p.max_uses} orders`);
  bits.push('', 'Customers who order with the code get the discount automatically, and I\'ll mention it when they ask about prices.');
  return bits.join('\n');
}

export function promoAnnouncement(p, businessName, currency = 'ETB') {
  const what = p.type === 'percent' ? `${p.value}% off` : `${fmtMoney(p.value, currency)} off`;
  const until = p.expires_at ? ` until ${new Date(new Date(p.expires_at).getTime() + EAT_MS).toISOString().slice(0, 10)}` : '';
  return `🎉 ${businessName}: ${what}${until}! Use code ${p.code} when you order.`;
}

// ── Morning brief ───────────────────────────────────────────────────────────
/**
 * Send the brief? Owners who turned it on always get it. Everyone else who
 * hasn't turned it off gets it only on days with something to act on, and
 * only while the shop is in use — never an "all quiet" message they didn't ask for.
 */
export function shouldSendBrief(cfg, stats, { activeRecently = false } = {}) {
  if (cfg?.enabled === false) return false;
  if (cfg?.enabled === true) return true;
  return activeRecently && briefActionable(stats);
}

export function briefActionable(s = {}) {
  return (s.waiting || 0) + (s.drafts || 0) + (s.debtors || 0) + (s.lowStock || 0) + (s.stale || 0) + (s.unpaid || 0) > 0;
}

export function briefText(s = {}, { businessName = 'your shop', ownerFirst = '', hour = 8, currency = 'ETB' } = {}) {
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const lines = [`${greet}${ownerFirst ? `, ${ownerFirst}` : ''} ☀️ — *${businessName}* today`, ''];
  const yday = [];
  if (s.revenue > 0) yday.push(`💰 ${fmtMoney(s.revenue, currency)} in sales`);
  if (s.expenses > 0) yday.push(`🧾 ${fmtMoney(s.expenses, currency)} spent`);
  if (s.messages > 0) yday.push(`💬 ${s.messages} customer message${s.messages === 1 ? '' : 's'}`);
  if (yday.length) lines.push('*Yesterday*', ...yday.map(x => `• ${x}`), '');
  const todo = [];
  if (s.waiting > 0) todo.push(`📥 ${s.waiting} ${s.waiting === 1 ? 'person is' : 'people are'} waiting for you`);
  if (s.drafts > 0) todo.push(`📝 ${s.drafts} draft repl${s.drafts === 1 ? 'y' : 'ies'} to approve`);
  if (s.unpaid > 0) todo.push(`⏳ ${s.unpaid} order${s.unpaid === 1 ? '' : 's'} waiting for payment`);
  if (s.debtors > 0) todo.push(`💸 ${s.debtors} ${s.debtors === 1 ? 'person owes' : 'people owe'} you ${fmtMoney(s.owed, currency)}${s.overdue ? ` (${s.overdue} overdue)` : ''}`);
  if (s.lowStock > 0) todo.push(`📦 ${s.lowStock} product${s.lowStock === 1 ? ' is' : 's are'} low or sold out`);
  if (s.stale > 0) todo.push(`🧹 ${s.stale} old order${s.stale === 1 ? '/job looks' : 's/jobs look'} open — tidy up?`);
  if (todo.length) lines.push('*Needs you*', ...todo.map(x => `• ${x}`));
  else lines.push('✅ Nothing needs you right now — I\'m on duty.');
  lines.push('', '_Tell me sales and costs as they happen and this gets smarter._');
  return lines.join('\n');
}

export function briefKeyboard(s = {}) {
  const row1 = [], row2 = [];
  if (s.waiting > 0 || s.drafts > 0) row1.push({ text: '📥 Who\'s waiting', callback_data: 'owner_inbox' });
  if (s.debtors > 0) row1.push({ text: '💸 Who owes me', callback_data: 'ops_debts' });
  if (s.lowStock > 0) row2.push({ text: '📦 Low stock', callback_data: 'ops_stock' });
  if (s.stale > 0) row2.push({ text: '🧹 Tidy up', callback_data: 'ops_tidy' });
  const rows = [row1, row2].filter(r => r.length);
  rows.push([{ text: '📊 Profit this month', callback_data: 'ops_profit' }, { text: '🔕 Stop daily brief', callback_data: 'ops_brief_off' }]);
  return rows;
}

/** Callback data this module's keyboards use; uuids keep it under Telegram's 64 bytes. */
export const OPS_PREFIX = 'ops_';
