/**
 * Weekly founder funnel report (spec §1) — pure builder + Telegram text.
 *
 * "This week" is the last COMPLETED Monday–Sunday week in Addis time, so a
 * Monday-morning run reports the seven days that just ended and a mid-week
 * look at the admin page shows the same numbers the Telegram message did.
 *
 * Internal (test) shops are excluded from every number, judged by their
 * CURRENT is_internal flag — marking a shop internal later removes it from
 * history too.
 */
import {
  FUNNEL_STEPS, isInternal, isRealCustomer, realInboundMessages, conversationsOf,
} from './events.mjs';

const DAY_MS = 86400000;
const EAT_MS = 3 * 3600 * 1000;
const ms = v => new Date(v).getTime();
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

/** Start (UTC ms) of the most recent Monday 00:00 Addis time at or before `now`. */
export function eatMondayStart(now = Date.now()) {
  const shifted = now + EAT_MS;
  const midnight = Math.floor(shifted / DAY_MS) * DAY_MS;
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return midnight - sinceMonday * DAY_MS - EAT_MS;
}

function shopsWithEvent(events, event, from = -Infinity, to = Infinity) {
  const ids = new Set();
  for (const e of events) {
    const t = ms(e.occurred_at);
    if (e.event === event && t >= from && t < to) ids.add(e.business_id);
  }
  return ids;
}

function rankShops(convs, bizById) {
  const by = new Map();
  for (const c of convs) {
    if (!by.has(c.business_id)) by.set(c.business_id, { conversations: 0, customers: new Set() });
    const r = by.get(c.business_id);
    r.conversations++;
    r.customers.add(c.customer_key);
  }
  return [...by.entries()]
    .map(([business_id, r]) => ({
      business_id, name: bizById.get(business_id)?.name || 'Unnamed shop',
      conversations: r.conversations, customers: r.customers.size,
    }))
    .sort((a, b) => b.conversations - a.conversations || (a.business_id < b.business_id ? -1 : 1));
}

function concentration(ranked) {
  const total = ranked.reduce((n, r) => n + r.conversations, 0);
  const top = ranked[0];
  if (!top || !total) return { pct: null, total, business_id: null, name: null, conversations: 0 };
  return { pct: pct(top.conversations, total), total, business_id: top.business_id, name: top.name, conversations: top.conversations };
}

/**
 * @param {object[]} input.events    funnel_events rows (all time)
 * @param {object[]} input.messages  inbound messages covering at least the last 30 days
 */
export function buildWeeklyReport({ businesses = [], customers = [], events = [], messages = [], adminIds = [], now = Date.now() }) {
  const external = businesses.filter(b => b && !isInternal(b));
  const bizById = new Map(external.map(b => [b.id, b]));
  const ev = events.filter(e => bizById.has(e.business_id));

  const monday = eatMondayStart(now);
  const week = [monday - 7 * DAY_MS, monday];
  const prev = [monday - 14 * DAY_MS, monday - 7 * DAY_MS];

  let before = null;
  const steps = FUNNEL_STEPS.map(event => {
    const cur = {
      this_week: shopsWithEvent(ev, event, ...week).size,
      last_week: shopsWithEvent(ev, event, ...prev).size,
      all_time: shopsWithEvent(ev, event).size,
    };
    const row = {
      event, ...cur,
      pct_this_week: before ? pct(cur.this_week, before.this_week) : null,
      pct_last_week: before ? pct(cur.last_week, before.last_week) : null,
      pct_all_time: before ? pct(cur.all_time, before.all_time) : null,
    };
    before = cur;
    return row;
  });

  const side = Object.fromEntries(['trial_started', 'subscription_renewed', 'churned'].map(event => [event, {
    this_week: shopsWithEvent(ev, event, ...week).size,
    last_week: shopsWithEvent(ev, event, ...prev).size,
  }]));

  const real = realInboundMessages({ businesses: external, customers, messages, adminIds });
  const between = (from, to) => conversationsOf(real.filter(m => { const t = ms(m.created_at); return t >= from && t < to; }));
  const rankedWeek = rankShops(between(...week), bizById);
  const rankedPrev = rankShops(between(...prev), bizById);
  const ranked30 = rankShops(between(now - 30 * DAY_MS, now + 1), bizById);
  const sum = r => r.reduce((n, x) => n + x.conversations, 0);

  const messaged = shopsWithEvent(ev, 'first_customer_message');
  const neverMessaged = ev
    .filter(e => e.event === 'onboarding_completed' && !messaged.has(e.business_id))
    .sort((a, b) => ms(b.occurred_at) - ms(a.occurred_at))
    .map(e => ({
      business_id: e.business_id,
      name: bizById.get(e.business_id)?.name || 'Unnamed shop',
      onboarded_at: e.occurred_at,
      approximate: e.metadata?.approximate === true,
    }));

  // Customer records: the same Telegram user at five shops is five records
  // but one person. Report both, never the first as if it were the second.
  const people = new Set();
  let records = 0;
  for (const c of customers) {
    const b = bizById.get(c.business_id);
    if (!b || !isRealCustomer(b, c, adminIds)) continue;
    records++;
    people.add(c.telegram_id != null ? `tg:${c.telegram_id}` : `id:${c.id}`);
  }

  return {
    generated_at: new Date(now).toISOString(),
    week: { from: new Date(week[0]).toISOString(), to: new Date(week[1]).toISOString() },
    prev_week: { from: new Date(prev[0]).toISOString(), to: new Date(prev[1]).toISOString() },
    shops: { total: external.length, internal_excluded: businesses.length - external.length },
    steps,
    side,
    // Spec rule: only payment_confirmed counts as a paying customer.
    paying_shops: shopsWithEvent(ev, 'payment_confirmed').size,
    conversations: { this_week: sum(rankedWeek), last_week: sum(rankedPrev), last_30_days: sum(ranked30) },
    active_shops: { this_week: rankedWeek.length, last_week: rankedPrev.length, last_30_days: ranked30.length },
    top_shops: rankedWeek.slice(0, 10),
    concentration: { this_week: concentration(rankedWeek), last_30_days: concentration(ranked30) },
    never_messaged: { count: neverMessaged.length, shops: neverMessaged },
    customers: { records, unique_people: people.size },
  };
}

// ── Telegram text (Amharic + English) ────────────────────────────────────────

const STEP_LABELS = {
  registered:             'የተመዘገቡ · Registered',
  onboarding_completed:   'ማዋቀር የጨረሱ · Finished onboarding',
  first_customer_message: 'የመጀመሪያ የደንበኛ መልእክት · First customer message',
  activated:              'ንቁ የሆኑ · Activated',
  payment_submitted:      'ክፍያ ያስገቡ · Payment submitted',
  payment_confirmed:      'ክፍያ የተረጋገጠ · Payment confirmed',
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dayLabel = iso => new Date(ms(iso) + EAT_MS).toISOString().slice(5, 10);
const pctText = p => (p == null ? '' : ` (${p}%)`);

export function formatWeeklyReport(report, { webUrl = '' } = {}) {
  const lastDay = new Date(ms(report.week.to) - DAY_MS).toISOString();
  const L = [];
  L.push('📊 <b>ሳምንታዊ የፈነል ሪፖርት · Weekly funnel</b>');
  L.push(`<i>${dayLabel(report.week.from)} → ${dayLabel(lastDay)} · በዚህ ሳምንት / ባለፈው ሳምንት · this week / last week</i>`);
  L.push('');
  for (const s of report.steps) {
    L.push(`• ${STEP_LABELS[s.event]}: <b>${s.this_week}</b>${pctText(s.pct_this_week)} / ${s.last_week}${pctText(s.pct_last_week)} · all-time ${s.all_time}`);
  }
  L.push('');
  L.push(`💳 የሚከፍሉ ሱቆች · Paying shops (confirmed only): <b>${report.paying_shops}</b>`);
  L.push(`🔁 Renewed ${report.side.subscription_renewed.this_week} · Churned ${report.side.churned.this_week} · Trials started ${report.side.trial_started.this_week}`);
  L.push('');
  L.push(`💬 የደንበኛ ውይይቶች · Customer conversations: <b>${report.conversations.this_week}</b> / ${report.conversations.last_week} · ${report.active_shops.this_week} shops`);
  const c = report.concentration.this_week;
  if (c.pct != null) {
    L.push(`${c.pct >= 40 ? '⚠️' : '📌'} ትልቁ ሱቅ · Biggest shop: ${esc(c.name)} = <b>${c.pct}%</b> of conversations (30 days: ${report.concentration.last_30_days.pct ?? '—'}%)`);
  }
  if (report.top_shops.length) {
    L.push('');
    L.push('🏆 <b>ከፍተኛ 10 ሱቆች · Top 10 shops</b>');
    report.top_shops.forEach((s, i) => L.push(`${i + 1}. ${esc(s.name)} — ${s.conversations} (${s.customers} customers)`));
  }
  L.push('');
  L.push(`📞 <b>ደንበኛ ያላገኙ ሱቆች · Onboarded, no customer yet: ${report.never_messaged.count}</b>`);
  report.never_messaged.shops.slice(0, 10).forEach(s => L.push(`• ${esc(s.name)} — ${dayLabel(s.onboarded_at)}${s.approximate ? ' ~' : ''}`));
  if (report.never_messaged.count > 10) L.push(`… +${report.never_messaged.count - 10} more on the admin page`);
  L.push('');
  L.push(`👥 ደንበኞች · Customers: ${report.customers.unique_people} people (${report.customers.records} records across shops)`);
  L.push(`<i>${report.shops.internal_excluded} test shops excluded</i>`);
  if (webUrl) L.push(`<a href="${webUrl}/admin">Open admin →</a>`);
  return L.join('\n');
}
