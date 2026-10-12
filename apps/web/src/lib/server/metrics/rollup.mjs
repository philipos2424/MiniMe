/**
 * Pure builders for the nightly admin rollups (spec 2026-10-13 §3.2–3.3).
 *
 * Inputs are plain rows already fetched by cron/metrics-rollup; outputs are
 * rows ready to upsert. No I/O here, so every rule is unit-tested in
 * __tests__/metricsRollup.test.mjs. Output carries ids, days, counts and
 * states only — never names, phones, telegram ids or message text.
 */
import {
  dayKeyEAT, isChainCall, isInternal, planState, paymentState, median, funnelStep, FUNNEL_STEPS,
} from './definitions.mjs';

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at);

/**
 * Time from the first inbound message of a customer turn to the next
 * successfully sent outbound in the same conversation. Messages without a
 * conversation_id cannot be paired and are skipped.
 */
export function replyLatencies(messages) {
  const byConv = new Map();
  for (const m of messages || []) {
    if (!m?.conversation_id) continue;
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }
  const out = [];
  for (const convo of byConv.values()) {
    convo.sort(byTime);
    let pending = null;
    for (const m of convo) {
      if (m.direction === 'inbound') { if (!pending) pending = m; continue; }
      if (m.direction === 'outbound' && m.status !== 'failed' && pending) {
        out.push({
          business_id: pending.business_id,
          inbound_at: pending.created_at,
          latency_s: Math.max(0, Math.round((new Date(m.created_at) - new Date(pending.created_at)) / 1000)),
        });
        pending = null;
      }
    }
  }
  return out;
}

const emptyShopRow = (business_id, day) => ({
  business_id, day,
  inbound_messages: 0, outbound_messages: 0, failed_messages: 0, ai_messages: 0,
  customers_active: 0, customers_new: 0,
  orders_created: 0, orders_paid: 0, paid_order_value_etb: 0,
  first_reply_p50_s: null, owner_sessions: 0,
  llm_calls: 0, llm_failed: 0, llm_cost_usd: 0, ai_tokens: 0,
  plan_state: null, payment_state: null,
});

export function buildShopDailyRows({
  days, todayKey, businesses = [], messages = [], customers = [], orders = [],
  llmCalls = [], aiUsage = [], uxEvents = [], source = 'cron', computedAt,
}) {
  const daySet = new Set(days);
  const external = new Map(businesses.filter(b => b && !isInternal(b)).map(b => [b.id, b]));
  const rows = new Map();
  const extra = new Map();

  const slot = (businessId, day) => {
    if (!external.has(businessId) || !daySet.has(day)) return null;
    const k = `${businessId}|${day}`;
    if (!rows.has(k)) {
      rows.set(k, emptyShopRow(businessId, day));
      extra.set(k, { customers: new Set(), sessions: new Set(), latencies: [] });
    }
    return k;
  };

  for (const m of messages) {
    const k = slot(m.business_id, dayKeyEAT(m.created_at));
    if (!k) continue;
    const r = rows.get(k);
    if (m.direction === 'inbound') {
      r.inbound_messages++;
      if (m.customer_id) extra.get(k).customers.add(m.customer_id);
    } else if (m.direction === 'outbound') {
      if (m.status === 'failed') r.failed_messages++;
      else {
        r.outbound_messages++;
        if (m.is_ai_generated) r.ai_messages++;
      }
    }
  }

  for (const l of replyLatencies(messages)) {
    const k = slot(l.business_id, dayKeyEAT(l.inbound_at));
    if (k) extra.get(k).latencies.push(l.latency_s);
  }

  for (const c of customers) {
    const k = slot(c.business_id, dayKeyEAT(c.first_contact_at || c.created_at));
    if (k) rows.get(k).customers_new++;
  }

  for (const o of orders) {
    const k1 = slot(o.business_id, dayKeyEAT(o.created_at));
    if (k1) rows.get(k1).orders_created++;
    if (o.paid_at && !o.refunded_at) {
      const k2 = slot(o.business_id, dayKeyEAT(o.paid_at));
      if (k2) {
        const r = rows.get(k2);
        r.orders_paid++;
        r.paid_order_value_etb += Number(o.total) || 0;
      }
    }
  }

  for (const l of llmCalls) {
    if (!isChainCall(l)) continue;
    const k = slot(l.business_id, dayKeyEAT(l.created_at));
    if (!k) continue;
    const r = rows.get(k);
    r.llm_calls++;
    if (l.ok === false) r.llm_failed++;
    r.llm_cost_usd += Number(l.total_cost_usd) || 0;
  }

  for (const a of aiUsage) {
    const k = slot(a.user_id, dayKeyEAT(a.created_at));
    if (k) rows.get(k).ai_tokens += Number(a.tokens_used) || 0;
  }

  for (const u of uxEvents) {
    if (u.surface !== 'dashboard' || !u.session_id) continue;
    const k = slot(u.business_id, dayKeyEAT(u.occurred_at || u.created_at));
    if (k) extra.get(k).sessions.add(u.session_id);
  }

  // State is only knowable "as of now", so it is written on today's row only.
  if (todayKey && daySet.has(todayKey)) {
    for (const b of external.values()) {
      const r = rows.get(slot(b.id, todayKey));
      r.plan_state = planState(b);
      r.payment_state = paymentState(b);
    }
  }

  return [...rows.entries()]
    .map(([k, r]) => {
      const x = extra.get(k);
      return {
        ...r,
        customers_active: x.customers.size,
        owner_sessions: x.sessions.size,
        first_reply_p50_s: median(x.latencies),
        paid_order_value_etb: round(r.paid_order_value_etb, 2),
        llm_cost_usd: round(r.llm_cost_usd, 6),
        source,
        computed_at: computedAt,
      };
    })
    .sort((a, b) => (a.business_id < b.business_id ? -1 : a.business_id > b.business_id ? 1 : a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

const SUM_FIELDS = ['inbound_messages', 'outbound_messages', 'failed_messages', 'orders_created', 'orders_paid', 'llm_calls', 'llm_failed', 'llm_cost_usd'];
const SUB_EVENTS = ['trial_converted', 'subscribed', 'expired'];

export function buildPlatformDailyRows({
  days, shopRows = [], businesses = [], onboardingEvents = [], subscriptionEvents = [], source = 'cron', computedAt,
}) {
  const internal = businesses.filter(isInternal);
  const internalIds = new Set(internal.map(b => b.id));
  const internalTg = new Set(internal.map(b => b.owner_telegram_id).filter(v => v != null).map(String));

  const out = new Map(days.map(day => [day, {
    day, signups: 0, live_shops: 0, engaged_owners: 0,
    ...Object.fromEntries(SUM_FIELDS.map(f => [f, 0])),
    ...Object.fromEntries(SUB_EVENTS.map(e => [e, 0])),
    funnel: Object.fromEntries(FUNNEL_STEPS.map(s => [s, 0])),
    source, computed_at: computedAt,
  }]));

  for (const b of businesses) {
    if (isInternal(b)) continue;
    const r = out.get(dayKeyEAT(b.created_at));
    if (r) r.signups++;
  }

  for (const s of shopRows) {
    const r = out.get(s.day);
    if (!r) continue;
    if (s.inbound_messages > 0) r.live_shops++;
    if (s.owner_sessions > 0) r.engaged_owners++;
    for (const f of SUM_FIELDS) r[f] += Number(s[f]) || 0;
  }

  const seen = new Map();
  for (const e of onboardingEvents) {
    const step = funnelStep(e.step);
    const day = dayKeyEAT(e.created_at);
    if (!step || !out.has(day) || e.telegram_id == null || internalTg.has(String(e.telegram_id))) continue;
    const k = `${day}|${step}`;
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(String(e.telegram_id));
  }
  for (const [k, ids] of seen) {
    const [day, step] = k.split('|');
    out.get(day).funnel[step] = ids.size;
  }

  for (const e of subscriptionEvents) {
    if (internalIds.has(e.business_id) || !SUB_EVENTS.includes(e.event)) continue;
    const r = out.get(dayKeyEAT(e.created_at));
    if (r) r[e.event]++;
  }

  return [...out.values()]
    .map(r => ({ ...r, llm_cost_usd: round(r.llm_cost_usd, 6) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
