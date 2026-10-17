/**
 * Pure builder for the admin Insights tab (spec 2026-10-13 §4).
 *
 * Inputs are rows the /api/admin/insights route already fetched; the output
 * is the whole JSON payload. No I/O, so every rule is unit-tested in
 * __tests__/metricsInsights.test.mjs.
 *
 * Privacy contract (GDPR art. 5(1)(c) minimisation, Telegram Bot Developer
 * Terms): the output holds counts, rates, days, shop ids and shop names only.
 * Owner names, phones, @handles, Telegram ids, buyer identities and message
 * text never appear — the route never even selects message text. Telegram ids
 * are read server-side for internal-shop exclusion and distinct counts, then
 * dropped. A test greps the payload for identifier patterns.
 */
import {
  dayKeyEAT, isChainCall, isInternal, planState, paymentState, median, FUNNEL_STEPS, funnelStep, STALE_AFTER_HOURS,
} from './definitions.mjs';
import { attributeShops } from './attribution.mjs';
import { priceFor, FREE_MODELS } from '../llmPricing.mjs';

const isFreeModel = m => FREE_MODELS.has(m) || (priceFor(m) && priceFor(m).in === 0 && priceFor(m).out === 0);

const DAY_MS = 86400000;
const round = (n, dp = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
const pct = (num, den) => (den > 0 ? round((100 * num) / den, 1) : null);
const num = v => Number(v) || 0;
const addDays = (dayKey, n) => new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Monday of the EAT week containing dayKey. */
export function weekStart(dayKey) {
  const dow = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  return addDays(dayKey, -((dow + 6) % 7));
}

/** Nearest-rank percentile; null for no data. */
export function percentile(nums, q) {
  const xs = (nums || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(q * xs.length) - 1))];
}

/** Current vs previous period, with % change (null when there's no base). */
export function delta(cur, prev) {
  const ok = Number.isFinite(cur) && Number.isFinite(prev) && prev > 0;
  return { value: cur, prev, change_pct: ok ? round((100 * (cur - prev)) / prev, 1) : null };
}

/** Breakdowns under this size are flagged so a 1-of-2 isn't read as "50%". */
export const LOW_N = 5;

const RETENTION_POLICY = [
  { data: 'Customer messages', keep: '18 months, then archived' },
  { data: 'Agent reasoning logs', keep: '6 months' },
  { data: 'Webhook events / dedupe', keep: '90 / 30 days' },
  { data: 'Owner usage events (ux_events)', keep: '90 days' },
  { data: 'Orders', keep: 'Kept (accounting)' },
  { data: 'Audit log', keep: '≥ 2 years' },
  { data: 'Daily rollups (this tab)', keep: 'Counts only, no personal data; owner erasure re-keys rows' },
];

const SENSITIVE_AUDIT = /impersonat|export|erase|delete|files_viewed|business_viewed|reveal/;

export function buildInsights({
  nDays, now = Date.now(), businesses = [], platformRows = [], shopRows = [],
  onboardingEvents = [], recentMessages = [], llmRecent = [], buyers = {}, audit = [], runs = [],
  attributionEvents = [], ordersAllTime = 0,
  proPriceEtb = 0,
}) {
  const todayKey = dayKeyEAT(now);
  const from = addDays(todayKey, -(nDays - 1));
  const prevFrom = addDays(from, -nDays);
  const inCur = d => d >= from && d <= todayKey;
  const inPrev = d => d >= prevFrom && d < from;

  const external = businesses.filter(b => b && !isInternal(b));
  const extIds = new Set(external.map(b => b.id));
  const internalTg = new Set(businesses.filter(isInternal).map(b => b.owner_telegram_id).filter(v => v != null).map(String));
  const shops = shopRows.filter(r => extIds.has(r.business_id));
  const signupDay = new Map(external.map(b => [b.id, dayKeyEAT(b.created_at)]));

  // ── Per-shop facts used by several sections ────────────────────────────
  const firstInbound = new Map();
  const lastInbound = new Map();
  const hadOrder = new Set();
  for (const r of shops) {
    if (r.orders_created > 0) hadOrder.add(r.business_id);
    if (r.inbound_messages > 0) {
      if (!firstInbound.has(r.business_id) || r.day < firstInbound.get(r.business_id)) firstInbound.set(r.business_id, r.day);
      if (!lastInbound.has(r.business_id) || r.day > lastInbound.get(r.business_id)) lastInbound.set(r.business_id, r.day);
    }
  }
  const states = new Map(external.map(b => [b.id, { plan: planState(b), pay: paymentState(b) }]));
  const attribution = attributeShops(external, attributionEvents);

  // ── KPIs: current period vs the one before ─────────────────────────────
  const agg = pred => {
    const live = new Set(), engaged = new Set();
    const t = { inbound: 0, outbound: 0, ai: 0, failed: 0, orders: 0, paid: 0, gmv: 0, buyersNew: 0, llmCalls: 0, llmFailed: 0, llmCost: 0 };
    for (const r of shops) {
      if (!pred(r.day)) continue;
      if (r.inbound_messages > 0) live.add(r.business_id);
      if (r.owner_sessions > 0) engaged.add(r.business_id);
      t.inbound += num(r.inbound_messages); t.outbound += num(r.outbound_messages); t.ai += num(r.ai_messages);
      t.failed += num(r.failed_messages); t.orders += num(r.orders_created); t.paid += num(r.orders_paid);
      t.gmv += num(r.paid_order_value_etb); t.buyersNew += num(r.customers_new);
      t.llmCalls += num(r.llm_calls); t.llmFailed += num(r.llm_failed); t.llmCost += num(r.llm_cost_usd);
    }
    const signups = external.filter(b => pred(signupDay.get(b.id))).length;
    return { ...t, live: live.size, engaged: engaged.size, signups };
  };
  const cur = agg(inCur), prev = agg(inPrev);
  const kpis = {
    signups: delta(cur.signups, prev.signups),
    live_shops: delta(cur.live, prev.live),
    engaged_owners: delta(cur.engaged, prev.engaged),
    inbound_messages: delta(cur.inbound, prev.inbound),
    ai_reply_share_pct: delta(pct(cur.ai, cur.outbound), pct(prev.ai, prev.outbound)),
    delivery_fail_pct: delta(pct(cur.failed, cur.failed + cur.outbound), pct(prev.failed, prev.failed + prev.outbound)),
    orders_created: delta(cur.orders, prev.orders),
    orders_paid: delta(cur.paid, prev.paid),
    gmv_etb: delta(round(cur.gmv, 0), round(prev.gmv, 0)),
    new_buyers: delta(cur.buyersNew, prev.buyersNew),
    llm_cost_usd: delta(round(cur.llmCost, 2), round(prev.llmCost, 2)),
  };

  // ── Daily series ───────────────────────────────────────────────────────
  const byDay = new Map();
  for (let i = 0; i < nDays; i++) {
    const day = addDays(from, i);
    byDay.set(day, { day, signups: 0, live_shops: 0, engaged_owners: 0, inbound: 0, outbound: 0, failed: 0, orders: 0, orders_paid: 0, gmv_etb: 0, new_buyers: 0, llm_calls: 0, llm_failed: 0, llm_cost_usd: 0, backfill: false });
  }
  for (const p of platformRows) {
    const d = byDay.get(p.day);
    if (d) d.backfill = p.source === 'backfill';
  }
  // Signups straight from businesses: exact, and live for today (the rollup's
  // today row is only a 02:00 snapshot).
  for (const b of external) {
    const d = byDay.get(signupDay.get(b.id));
    if (d) d.signups++;
  }
  if (byDay.has(todayKey)) byDay.get(todayKey).partial = true;
  for (const r of shops) {
    const d = byDay.get(r.day);
    if (!d) continue;
    if (r.inbound_messages > 0) d.live_shops++;
    if (r.owner_sessions > 0) d.engaged_owners++;
    d.inbound += num(r.inbound_messages); d.outbound += num(r.outbound_messages); d.failed += num(r.failed_messages);
    d.orders += num(r.orders_created); d.orders_paid += num(r.orders_paid); d.gmv_etb += num(r.paid_order_value_etb);
    d.new_buyers += num(r.customers_new); d.llm_calls += num(r.llm_calls); d.llm_failed += num(r.llm_failed); d.llm_cost_usd += num(r.llm_cost_usd);
  }
  const series = [...byDay.values()].map(d => ({ ...d, gmv_etb: round(d.gmv_etb, 0), llm_cost_usd: round(d.llm_cost_usd, 4) }));

  // ── Today: is anything broken or waiting on me? ────────────────────────
  const ago24 = now - DAY_MS;
  const recent = recentMessages.filter(m => extIds.has(m.business_id) && Date.parse(m.created_at) >= ago24);
  const out24 = recent.filter(m => m.direction === 'outbound');
  const failed24 = out24.filter(m => m.status === 'failed').length;
  const chain24 = llmRecent.filter(l => isChainCall(l) && Date.parse(l.created_at) >= ago24);
  const llmFail24 = chain24.filter(l => l.ok === false).length;
  const lastWeekSameDay = addDays(todayKey, -7);
  const lastOk = runs.find(r => r.ok && r.finished_at);
  const rollupAgeH = lastOk ? round((now - Date.parse(lastOk.finished_at)) / 3600000, 1) : null;
  const claimed = [...states.values()].filter(s => s.pay === 'claimed').length;

  const today = {
    signups_today: external.filter(b => signupDay.get(b.id) === todayKey).length,
    signups_same_weekday_last_week: external.filter(b => signupDay.get(b.id) === lastWeekSameDay).length,
    live_shops_24h: new Set(recent.filter(m => m.direction === 'inbound').map(m => m.business_id)).size,
    inbound_24h: recent.filter(m => m.direction === 'inbound').length,
    delivery_fail_pct_24h: pct(failed24, out24.length),
    llm_calls_24h: chain24.length,
    llm_fail_pct_24h: pct(llmFail24, chain24.length),
    payments_awaiting_review: claimed,
    rollup: {
      last_ok_at: lastOk?.finished_at || null,
      age_hours: rollupAgeH,
      stale: rollupAgeH == null || rollupAgeH > STALE_AFTER_HOURS,
      last_run_failed: runs[0] ? runs[0].ok === false : false,
    },
  };
  const alerts = [];
  if (today.llm_fail_pct_24h != null && today.llm_fail_pct_24h >= 10) alerts.push({ level: 'danger', text: `AI chain failing on ${today.llm_fail_pct_24h}% of calls (24 h)` });
  if (today.delivery_fail_pct_24h != null && today.delivery_fail_pct_24h >= 5) alerts.push({ level: 'danger', text: `${today.delivery_fail_pct_24h}% of outbound messages failed to deliver (24 h)` });
  if (today.rollup.stale) alerts.push({ level: 'warn', text: 'Nightly rollup is stale — history charts may be behind' });
  if (claimed > 0) alerts.push({ level: 'warn', text: `${claimed} payment${claimed === 1 ? '' : 's'} awaiting verification` });
  if (today.signups_same_weekday_last_week >= 4 && today.signups_today < today.signups_same_weekday_last_week / 2) {
    alerts.push({ level: 'warn', text: `Signups today (${today.signups_today}) are under half of last ${new Date(`${todayKey}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })} (${today.signups_same_weekday_last_week})` });
  }
  today.alerts = alerts;

  // ── Money ──────────────────────────────────────────────────────────────
  const countBy = (key) => {
    const o = {};
    for (const s of states.values()) o[s[key]] = (o[s[key]] || 0) + 1;
    return o;
  };
  const payDist = countBy('pay');
  const paying = (payDist.paid || 0) + (payDist.claimed || 0);
  const nowIso = new Date(now).toISOString(), in7Iso = new Date(now + 7 * DAY_MS).toISOString();
  const fromIso = new Date(`${from}T00:00:00+03:00`).toISOString();
  const trialsEndedInRange = external.filter(b => b.trial_ends_at && b.trial_ends_at >= fromIso && b.trial_ends_at <= nowIso);
  const trialsConvertedNow = trialsEndedInRange.filter(b => ['paid', 'claimed'].includes(states.get(b.id).pay)).length;
  const subEvents = k => platformRows.filter(p => inCur(p.day)).reduce((s, p) => s + num(p[k]), 0);
  const money = {
    plan_states: countBy('plan'),
    payment_states: payDist,
    paying_shops: paying,
    mrr_estimate_etb: paying * proPriceEtb,
    mrr_basis: `paying shops × ${proPriceEtb} ETB list price (annual plans counted monthly)`,
    granted_unpaid: payDist.granted || 0,
    wanted_to_pay: payDist.interested || 0,
    trials_ending_7d: external.filter(b => states.get(b.id).plan === 'trial' && b.trial_ends_at && b.trial_ends_at >= nowIso && b.trial_ends_at <= in7Iso).length,
    trials_ended_in_range: trialsEndedInRange.length,
    trial_to_paid_pct: pct(trialsConvertedNow, trialsEndedInRange.length),
    events: { trial_converted: subEvents('trial_converted'), subscribed: subEvents('subscribed'), expired: subEvents('expired') },
    ai_cost_per_paying_shop_usd: paying ? round(cur.llmCost / paying, 3) : null,
  };

  // ── Growth: funnel, activation, cohorts ────────────────────────────────
  // Owners enter onboarding at different steps (mini-app signup skips the
  // welcome, shared vs custom bot connect), so per-step distinct counts are
  // not monotonic. Count "reached this step or any later one" instead.
  const furthest = new Map();
  for (const e of onboardingEvents) {
    const step = funnelStep(e.step);
    if (!step || e.telegram_id == null || internalTg.has(String(e.telegram_id)) || !inCur(dayKeyEAT(e.created_at))) continue;
    const k = String(e.telegram_id), idx = FUNNEL_STEPS.indexOf(step);
    if (!(furthest.get(k) >= idx)) furthest.set(k, idx);
  }
  const withRates = rows => rows.map((f, i) => ({
    ...f,
    pct_of_top: pct(f.count, rows[0].count),
    pct_of_prev: i === 0 ? null : pct(f.count, rows[i - 1].count),
  }));
  const reachedAtLeast = idx => [...furthest.values()].filter(v => v >= idx).length;
  const onboardingFunnel = withRates(FUNNEL_STEPS.map((step, idx) => ({ step, count: reachedAtLeast(idx) })));

  // Shops created in the range, followed forward. Each step requires the last.
  const cohortShops = external.filter(b => inCur(signupDay.get(b.id)));
  const live = cohortShops.filter(b => firstInbound.get(b.id) >= signupDay.get(b.id));
  const ordered = live.filter(b => hadOrder.has(b.id));
  const shopFunnel = withRates([
    { step: 'shop_created', count: cohortShops.length },
    { step: 'first_customer_message', count: live.length },
    { step: 'first_order', count: ordered.length },
    { step: 'paying', count: cohortShops.filter(b => ['paid', 'claimed'].includes(states.get(b.id).pay)).length },
  ]);
  const funnel = { onboarding: onboardingFunnel, shops: shopFunnel };

  // Activation = live within 7 days of signup. Only shops 7+ days old count,
  // or the newest cohort drags the rate down for not having had the time.
  const matured = cohortShops.filter(b => daysBetween(signupDay.get(b.id), todayKey) >= 7);
  const isActivated = b => firstInbound.has(b.id) && daysBetween(signupDay.get(b.id), firstInbound.get(b.id)) <= 7 && firstInbound.get(b.id) >= signupDay.get(b.id);
  const groupActivation = (keyFn) => {
    const g = new Map();
    for (const b of matured) {
      const k = keyFn(b) || '(unknown)';
      if (!g.has(k)) g.set(k, { key: k, signups: 0, activated: 0 });
      const x = g.get(k); x.signups++; if (isActivated(b)) x.activated++;
    }
    return [...g.values()].map(x => ({ ...x, rate_pct: pct(x.activated, x.signups), low_n: x.signups < LOW_N }))
      .sort((a, b) => b.signups - a.signups).slice(0, 12);
  };
  const activation = {
    matured_signups: matured.length,
    activated: matured.filter(isActivated).length,
    rate_pct: pct(matured.filter(isActivated).length, matured.length),
    by_source: groupActivation(b => attribution.get(b.id).channel),
    by_category: groupActivation(b => b.category_canonical),
  };

  // Weekly signup cohorts; a shop is retained in week k if it had customer
  // traffic or an owner session that week.
  const activeWeeks = new Map();
  for (const r of shops) {
    if (!(r.inbound_messages > 0 || r.owner_sessions > 0)) continue;
    if (!activeWeeks.has(r.business_id)) activeWeeks.set(r.business_id, new Set());
    activeWeeks.get(r.business_id).add(weekStart(r.day));
  }
  const thisWeek = weekStart(todayKey);
  const cohorts = [];
  for (let w = 11; w >= 0; w--) {
    const start = addDays(thisWeek, -7 * w);
    const members = external.filter(b => weekStart(signupDay.get(b.id)) === start);
    const weeks = [];
    for (let k = 0; k <= w; k++) {
      const wk = addDays(start, 7 * k);
      weeks.push(pct(members.filter(b => activeWeeks.get(b.id)?.has(wk)).length, members.length));
    }
    cohorts.push({ week: start, size: members.length, retention_pct: weeks });
  }

  // ── Engagement (owners) ────────────────────────────────────────────────
  const engagedIn = (fromDay) => new Set(shops.filter(r => r.day >= fromDay && r.day <= todayKey && r.owner_sessions > 0).map(r => r.business_id)).size;
  const last7 = series.slice(-7);
  const dau = last7.length ? round(last7.reduce((s, d) => s + d.engaged_owners, 0) / last7.length, 1) : null;
  const mau = engagedIn(addDays(todayKey, -29));
  const engagement = {
    dau_avg_7d: dau, wau: engagedIn(addDays(todayKey, -6)), mau,
    stickiness_pct: mau ? pct(dau, mau) : null,
    note: 'Owner sessions come from dashboard usage events, which are kept 90 days.',
  };

  // ── Buyers (aggregates only) ───────────────────────────────────────────
  const latencies = shops.filter(r => inCur(r.day) && r.first_reply_p50_s != null).map(r => r.first_reply_p50_s);
  const buyerStats = {
    total: num(buyers.total),
    active_in_range: num(buyers.active),
    new_in_range: num(buyers.new),
    returning_in_range: Math.max(0, num(buyers.active) - num(buyers.activeNew)),
    returning_pct: pct(Math.max(0, num(buyers.active) - num(buyers.activeNew)), num(buyers.active)),
    opted_out: num(buyers.optedOut),
    opt_out_pct: pct(num(buyers.optedOut), num(buyers.total)),
    orders_per_100_inbound: cur.inbound ? round((100 * cur.orders) / cur.inbound, 1) : null,
    avg_order_value_etb: cur.paid ? round(cur.gmv / cur.paid, 0) : null,
    reply_p50_s: median(latencies),
    reply_p90_s: percentile(latencies, 0.9),
    reply_under_1m_pct: pct(latencies.filter(s => s <= 60).length, latencies.length),
    reply_under_5m_pct: pct(latencies.filter(s => s <= 300).length, latencies.length),
  };

  // ── AI & ops ───────────────────────────────────────────────────────────
  const models = new Map();
  for (const l of llmRecent) {
    if (!isChainCall(l)) continue;
    const k = l.model || '(unknown)';
    if (!models.has(k)) models.set(k, { model: k, calls: 0, failed: 0, cost_usd: 0, tokens: 0, withTokens: 0, lat: [] });
    const m = models.get(k);
    m.calls++; if (l.ok === false) m.failed++;
    m.cost_usd += num(l.total_cost_usd);
    const tok = num(l.prompt_tokens) + num(l.completion_tokens);
    m.tokens += tok; if (tok > 0) m.withTokens++;
    if (Number.isFinite(l.latency_ms)) m.lat.push(l.latency_ms);
  }
  const byModel = [...models.values()];
  const freeOnly = byModel.length > 0 && byModel.every(m => m.calls === m.failed || isFreeModel(m.model));
  const ai = {
    calls: cur.llmCalls, failed: cur.llmFailed, fail_pct: pct(cur.llmFailed, cur.llmCalls),
    cost_usd: round(cur.llmCost, 2),
    // Cost is whatever llmPricing.mjs says. A model priced $0 there may still
    // be billed by its provider (Gemini was, before main priced it), so say
    // where the zero comes from instead of calling it free. Tokens are the
    // usage signal that stays meaningful either way.
    cost_note: cur.llmCost === 0 && cur.llmCalls > 0
      ? (freeOnly ? 'Live models are priced $0 in llmPricing.mjs — check against the provider bill' : 'No cost logged — check pricing table')
      : null,
    tokens_7d: byModel.reduce((s, m) => s + m.tokens, 0),
    cost_per_ai_reply_usd: cur.ai ? round(cur.llmCost / cur.ai, 4) : null,
    cost_per_live_shop_usd: cur.live ? round(cur.llmCost / cur.live, 3) : null,
    by_model_7d: byModel.map(m => ({
      model: m.model, calls: m.calls, fail_pct: pct(m.failed, m.calls), cost_usd: round(m.cost_usd, 3),
      tokens: m.tokens, p50_ms: percentile(m.lat, 0.5), p95_ms: percentile(m.lat, 0.95),
      priced: priceFor(m.model) != null,
    })).sort((a, b) => b.calls - a.calls).slice(0, 12),
  };

  // ── Acquisition (first-touch attribution) ──────────────────────────────
  const chan = new Map();
  for (const b of cohortShops) {
    const a = attribution.get(b.id);
    if (!chan.has(a.channel)) chan.set(a.channel, { key: a.channel, signups: 0, live: 0, paying: 0 });
    const c = chan.get(a.channel);
    c.signups++;
    if (firstInbound.get(b.id) >= signupDay.get(b.id)) c.live++;
    if (['paid', 'claimed'].includes(states.get(b.id).pay)) c.paying++;
  }
  const basisCount = {};
  for (const a of attribution.values()) basisCount[a.basis] = (basisCount[a.basis] || 0) + 1;
  const acquisition = {
    by_channel: [...chan.values()].map(c => ({ ...c, live_pct: pct(c.live, c.signups), low_n: c.signups < LOW_N }))
      .sort((a, b) => b.signups - a.signups),
    basis: basisCount,
    attributed_pct: pct(external.length - (basisCount.unattributed || 0), external.length),
  };

  // ── Data quality: which of these numbers can you trust? ────────────────
  const chainRecent = llmRecent.filter(isChainCall);
  const okRecent = chainRecent.filter(l => l.ok !== false);
  const sessionDays = shops.filter(r => r.owner_sessions > 0).map(r => r.day).sort();
  const rollupDays = new Set(platformRows.filter(p => inCur(p.day)).map(p => p.day)).size;
  const unpriced = byModel.filter(m => priceFor(m.model) == null).map(m => m.model);
  const q = (key, label, value, status, note) => ({ key, label, value, status, note });
  const tier = (v, good, warn) => (v == null ? 'warn' : v >= good ? 'good' : v >= warn ? 'warn' : 'bad');
  const dataQuality = [
    q('attribution', 'Shops with a known acquisition channel', acquisition.attributed_pct, tier(acquisition.attributed_pct, 60, 25),
      'Tag every link you share: t.me/MiniMeAgentBot?start=src_tiktok_oct (or ?startapp= for the app). New arrivals are attributed automatically.'),
    q('category', 'Shops with a category', pct(external.filter(b => b.category_canonical).length, external.length),
      tier(pct(external.filter(b => b.category_canonical).length, external.length), 80, 50), 'The rest chose "other"/"retail" — no signal to map.'),
    q('ai_tokens', 'Successful AI calls with token counts (7 d)', pct(okRecent.filter(l => num(l.prompt_tokens) + num(l.completion_tokens) > 0).length, okRecent.length),
      tier(pct(okRecent.filter(l => num(l.prompt_tokens) + num(l.completion_tokens) > 0).length, okRecent.length), 95, 80),
      unpriced.length ? `Logged under names with no price row: ${unpriced.join(', ')}` : 'Every logged model has a price row.'),
    q('orders', 'Sales recorded as orders', ordersAllTime, ordersAllTime >= 100 ? 'good' : 'bad',
      'Most sales close in chat or off-platform, so orders/GMV undercount real trade. Treat them as a floor.'),
    q('owner_sessions', 'Owner session history since', sessionDays[0] || null, 'warn',
      'From dashboard usage events, purged after 90 days; captured nightly into rollups from then on.'),
    q('rollup', 'Days in range covered by rollups', pct(rollupDays, nDays), tier(pct(rollupDays, nDays), 99, 90), 'Missing days mean the nightly job did not run.'),
  ];

  // ── Shop segments ──────────────────────────────────────────────────────
  const d7 = addDays(todayKey, -6), d30 = addDays(todayKey, -29);
  const inboundBetween = (id, a, b) => shops.reduce((s, r) => s + (r.business_id === id && r.day >= a && r.day <= b ? num(r.inbound_messages) : 0), 0);
  const seg = { active: 0, at_risk: 0, dormant: 0, never_live: 0 };
  const atRisk = [];
  const segOf = new Map();
  for (const b of external) {
    const last = lastInbound.get(b.id);
    let s;
    if (!last) s = 'never_live';
    else if (last >= d7) s = 'active';
    else if (last >= d30) s = 'at_risk';
    else s = 'dormant';
    seg[s]++; segOf.set(b.id, s);
    if (s === 'at_risk') atRisk.push({ id: b.id, name: b.name || '(unnamed shop)', category: b.category_canonical || null, last_active_day: last, inbound_prev_30d: inboundBetween(b.id, d30, todayKey), plan_state: states.get(b.id).plan });
  }
  const catActive = new Map();
  for (const b of external) {
    if (segOf.get(b.id) !== 'active') continue;
    const k = b.category_canonical || '(uncategorised)';
    catActive.set(k, (catActive.get(k) || 0) + 1);
  }
  const perShop = new Map();
  for (const r of shops) {
    if (!inCur(r.day)) continue;
    if (!perShop.has(r.business_id)) perShop.set(r.business_id, { inbound: 0, orders_paid: 0, gmv_etb: 0, sessions: 0, lat: [] });
    const p = perShop.get(r.business_id);
    p.inbound += num(r.inbound_messages); p.orders_paid += num(r.orders_paid); p.gmv_etb += num(r.paid_order_value_etb); p.sessions += num(r.owner_sessions);
    if (r.first_reply_p50_s != null) p.lat.push(r.first_reply_p50_s);
  }
  const nameOf = new Map(external.map(b => [b.id, b.name || '(unnamed shop)']));
  const segments = {
    counts: seg,
    active_by_category: [...catActive.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    at_risk: atRisk.sort((a, b) => b.inbound_prev_30d - a.inbound_prev_30d).slice(0, 15),
    top_shops: [...perShop.entries()].filter(([, p]) => p.inbound > 0)
      .map(([id, p]) => ({ id, name: nameOf.get(id), inbound: p.inbound, orders_paid: p.orders_paid, gmv_etb: round(p.gmv_etb, 0), owner_sessions: p.sessions, reply_p50_s: median(p.lat), plan_state: states.get(id)?.plan || null }))
      .sort((a, b) => b.inbound - a.inbound).slice(0, 10),
  };

  // ── Trust & privacy ────────────────────────────────────────────────────
  const auditCounts = new Map();
  for (const a of audit) {
    if (!SENSITIVE_AUDIT.test(a.action || '')) continue;
    auditCounts.set(a.action, (auditCounts.get(a.action) || 0) + 1);
  }
  const privacy = {
    owners_with_consent_pct: pct(external.filter(b => b.consent_at).length, external.length),
    owner_nudge_opt_outs: external.filter(b => b.notification_prefs?.owner_nudges?.opted_out === true).length,
    owner_bot_blocked: external.filter(b => b.notification_prefs?.owner_dm_blocked === true).length,
    buyer_opt_outs: num(buyers.optedOut),
    sensitive_admin_actions_30d: [...auditCounts.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
    retention: RETENTION_POLICY,
  };

  return {
    range: { days: nDays, from, to: todayKey, prev_from: prevFrom },
    generated_at: new Date(now).toISOString(),
    today, kpis, series, money, funnel, activation, cohorts, engagement,
    buyers: buyerStats, ai, segments, privacy, acquisition, data_quality: dataQuality,
  };
}
