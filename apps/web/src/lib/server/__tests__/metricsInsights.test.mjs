import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildInsights, weekStart, percentile, delta } from '../metrics/insights.mjs';

// 2026-10-17 12:00 EAT
const NOW = Date.parse('2026-10-17T09:00:00Z');
const future = d => new Date(NOW + d * 86400000).toISOString();
const day = n => new Date(NOW + n * 86400000 + 3 * 3600000).toISOString().slice(0, 10);
const at = n => new Date(NOW + n * 86400000).toISOString();

const A = { id: 'a', name: 'Abebe Shoes', created_at: at(-20), owner_telegram_id: 111111111, owner_name: 'Abebe Kebede', owner_phone: '+251911223344', owner_username: 'abebe_k', subscription_status: 'trial', trial_ends_at: future(3), consent_at: at(-20) };
const B = { id: 'b', name: 'Bole Cafe', created_at: at(-40), owner_telegram_id: 222222222, plan_tier: 'pro', payment_verified: true, payment_ref: 'TX1', subscription_status: 'active', subscription_expires_at: future(20), notification_prefs: { owner_nudges: { opted_out: true } } };
const C = { id: 'c', name: 'Quiet Shop', created_at: at(-2), owner_telegram_id: 333333333 };
const INTERNAL = { id: 'i', name: 'Test', created_at: at(-1), is_internal: true, owner_telegram_id: 999999999 };

const shopRow = (business_id, d, over = {}) => ({ business_id, day: day(d), inbound_messages: 0, outbound_messages: 0, failed_messages: 0, ai_messages: 0, customers_new: 0, orders_created: 0, orders_paid: 0, paid_order_value_etb: 0, owner_sessions: 0, llm_calls: 0, llm_failed: 0, llm_cost_usd: 0, first_reply_p50_s: null, ...over });

const input = (over = {}) => ({
  nDays: 7, now: NOW, proPriceEtb: 1999,
  businesses: [A, B, C, INTERNAL],
  shopRows: [
    shopRow('a', -19, { inbound_messages: 3 }),                       // activated within 7d of signup
    shopRow('a', -1, { inbound_messages: 10, outbound_messages: 8, ai_messages: 6, failed_messages: 2, orders_created: 2, orders_paid: 1, paid_order_value_etb: 500, owner_sessions: 2, llm_calls: 10, llm_failed: 1, llm_cost_usd: 0.02, first_reply_p50_s: 30 }),
    shopRow('b', -12, { inbound_messages: 4 }),                       // previous period only → at risk
    shopRow('b', -10, { inbound_messages: 5, owner_sessions: 1, first_reply_p50_s: 400 }),
    shopRow('i', 0, { inbound_messages: 99, llm_cost_usd: 9 }),       // internal: must vanish
  ],
  platformRows: [{ day: day(-1), signups: 1, source: 'cron' }],
  onboardingEvents: [
    { telegram_id: 333333333, step: 'welcome', created_at: at(-2) },
    { telegram_id: 333333333, step: 'signup', created_at: at(-2) },
    { telegram_id: 444444444, step: 'welcome', created_at: at(-1) },
    { telegram_id: 999999999, step: 'welcome', created_at: at(-1) },  // internal owner
  ],
  recentMessages: [
    { business_id: 'a', direction: 'inbound', status: 'sent', created_at: at(-0.2) },
    { business_id: 'a', direction: 'outbound', status: 'failed', created_at: at(-0.2) },
    { business_id: 'a', direction: 'outbound', status: 'sent', created_at: at(-0.2) },
    { business_id: 'i', direction: 'inbound', status: 'sent', created_at: at(-0.1) },
  ],
  llmRecent: [
    { model: 'm1', route: 'reply', ok: true, latency_ms: 800, total_cost_usd: 0.01, created_at: at(-0.5) },
    { model: 'm1', route: 'reply', ok: false, latency_ms: 2000, total_cost_usd: 0, created_at: at(-0.5) },
    { model: 'm1', route: 'raw:openai', ok: false, latency_ms: 10, created_at: at(-0.5) },
  ],
  buyers: { total: 50, active: 10, new: 4, activeNew: 4, optedOut: 2 },
  audit: [{ action: 'admin.impersonate_started' }, { action: 'admin.files_viewed' }, { action: 'owner_nudges.run' }],
  runs: [{ ok: true, finished_at: at(-0.3) }],
  ...over,
});

test('internal shops are excluded everywhere', () => {
  const r = buildInsights(input());
  assert.equal(r.kpis.inbound_messages.value, 10);
  assert.equal(r.kpis.llm_cost_usd.value, 0.02);
  assert.equal(r.today.live_shops_24h, 1);
  assert.equal(r.today.signups_today, 0);
  assert.equal(r.funnel.onboarding.find(f => f.step === 'welcome').count, 2);
  assert.ok(!r.segments.top_shops.some(s => s.id === 'i'));
});

test('kpis compare against the previous period', () => {
  const r = buildInsights(input());
  assert.deepEqual(r.kpis.inbound_messages, { value: 10, prev: 9, change_pct: 11.1 });
  assert.equal(r.kpis.delivery_fail_pct.value, 20);
  assert.equal(r.kpis.ai_reply_share_pct.value, 75);
  assert.equal(delta(null, 5).change_pct, null);
  assert.equal(delta(5, 0).change_pct, null);
});

test('today flags failures and pending payments', () => {
  const r = buildInsights(input({ businesses: [A, B, C, INTERNAL, { id: 'p', created_at: at(-5), payment_proof_url: 'x', subscription_status: 'active', subscription_expires_at: future(20) }] }));
  assert.equal(r.today.delivery_fail_pct_24h, 50);
  assert.equal(r.today.llm_fail_pct_24h, 50); // raw:* attempts are not chain calls
  assert.ok(r.today.alerts.some(a => /AI chain failing/.test(a.text)));
  assert.equal(r.today.rollup.stale, false);
});

test('onboarding funnel is monotonic even when people skip steps', () => {
  const r = buildInsights(input({ onboardingEvents: [
    { telegram_id: 5, step: 'signup', created_at: at(-1) },          // mini-app entry, no welcome
    { telegram_id: 6, step: 'welcome', created_at: at(-1) },
    { telegram_id: 7, step: 'connected_shared', created_at: at(-1) }, // alias, skipped "connect"
  ] }));
  const c = Object.fromEntries(r.funnel.onboarding.map(f => [f.step, f.count]));
  assert.equal(c.welcome, 3);
  assert.equal(c.signup, 2);
  assert.equal(c.connect, 1);
  assert.equal(c.connected, 1);
  const counts = r.funnel.onboarding.map(f => f.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

test('shop funnel follows shops created in range', () => {
  const r = buildInsights(input({ nDays: 30 }));
  assert.deepEqual(r.funnel.shops.map(f => f.count), [2, 1, 1, 0]); // a + c created; a live + ordered
});

test('today is live and marked partial in the series; zero AI cost is "not reported"', () => {
  const r = buildInsights(input({ businesses: [A, B, C, INTERNAL, { id: 'n', created_at: at(0) }] }));
  const last = r.series.at(-1);
  assert.equal(last.partial, true);
  assert.equal(last.signups, 1);
  const free = buildInsights(input({ shopRows: [shopRow('a', -1, { llm_calls: 5 })], llmRecent: [{ model: 'llama3.2', route: 'reply', ok: true, prompt_tokens: 100, completion_tokens: 20, created_at: at(-1) }] }));
  assert.match(free.ai.cost_note, /priced \$0 in llmPricing/);
  assert.equal(free.ai.tokens_7d, 120);
  assert.equal(buildInsights(input()).ai.cost_note, null);
});

test('stale rollup raises an alert', () => {
  const r = buildInsights(input({ runs: [{ ok: false }, { ok: true, finished_at: at(-3) }] }));
  assert.equal(r.today.rollup.stale, true);
  assert.equal(r.today.rollup.last_run_failed, true);
});

test('activation counts only shops at least 7 days old', () => {
  const r = buildInsights(input({ nDays: 30 }));
  // a (20d, live day 1) and b (40d → outside range) ; c is 2 days old → not matured
  assert.equal(r.activation.matured_signups, 1);
  assert.equal(r.activation.activated, 1);
  assert.equal(r.activation.by_source[0].low_n, true);
});

test('segments classify by last customer message', () => {
  const r = buildInsights(input());
  assert.deepEqual(r.segments.counts, { active: 1, at_risk: 1, dormant: 0, never_live: 1 });
  assert.equal(r.segments.at_risk[0].id, 'b');
  assert.equal(r.segments.at_risk[0].inbound_prev_30d, 9);
});

test('money uses paymentState, never re-derived', () => {
  const r = buildInsights(input());
  assert.equal(r.money.paying_shops, 1);
  assert.equal(r.money.mrr_estimate_etb, 1999);
  assert.equal(r.money.trials_ending_7d, 1);
  assert.equal(r.privacy.owner_nudge_opt_outs, 1);
});

test('buyer aggregates and reply latency', () => {
  const r = buildInsights(input({ nDays: 30 }));
  assert.equal(r.buyers.opt_out_pct, 4);
  assert.equal(r.buyers.returning_in_range, 6);
  assert.equal(r.buyers.reply_under_1m_pct, 50);
});

test('privacy: payload carries no personal identifiers', () => {
  const json = JSON.stringify(buildInsights(input({ nDays: 30 })));
  for (const leak of ['Abebe Kebede', '+251911223344', 'abebe_k', '111111111', '222222222', '333333333', '444444444']) {
    assert.ok(!json.includes(leak), `leaked ${leak}`);
  }
  assert.doesNotMatch(json, /\+?251\d{9}/);
  assert.doesNotMatch(json, /owner_(name|phone|username|telegram_id)|telegram_id|tg_user_id/);
  assert.ok(json.includes('admin.impersonate_started'));
  assert.ok(!json.includes('owner_nudges.run')); // only sensitive actions surface
});

test('route never selects personal columns or message text', () => {
  const src = readFileSync(new URL('../../../app/api/admin/insights/route.js', import.meta.url), 'utf8');
  assert.match(src, /requireAdminRequest/);
  assert.match(src, /no-store/);
  for (const col of ['owner_name', 'owner_phone', 'owner_username', 'content', 'text', 'phone', 'telegram_username', 'email']) {
    assert.doesNotMatch(src, new RegExp(`select\\([^)]*\\b${col}\\b`), `route selects ${col}`);
  }
});

test('helpers', () => {
  assert.equal(weekStart('2026-10-17'), '2026-10-12'); // Saturday → Monday
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.equal(percentile([1, 2, 3, 4, 100], 0.95), 100);
  assert.equal(percentile([], 0.5), null);
});

test('acquisition uses first-touch attribution and data quality is reported', () => {
  const r = buildInsights(input({
    nDays: 30,
    attributionEvents: [
      { telegram_id: 111111111, step: 'entry_link', meta: { tag: 'src_tiktok_oct' }, created_at: at(-21) },
      { telegram_id: 333333333, step: 'entry_link', meta: { tag: 'fb_ad' }, created_at: at(0) }, // after signup: ignored
    ],
    ordersAllTime: 17,
    llmRecent: [
      { model: 'summary', route: '__daily_summary__', ok: true, prompt_tokens: 9e6, created_at: at(-1) },
      { model: 'mystery-1', route: 'reply', ok: true, prompt_tokens: 5, created_at: at(-1) },
    ],
  }));
  const ch = Object.fromEntries(r.acquisition.by_channel.map(c => [c.key, c.signups]));
  assert.equal(ch.instagram_tiktok, 1);
  assert.equal(ch.unattributed, 1);
  assert.equal(r.activation.by_source.find(g => g.key === 'instagram_tiktok').signups, 1);
  const dq = Object.fromEntries(r.data_quality.map(d => [d.key, d]));
  assert.equal(dq.orders.status, 'bad');
  assert.match(dq.ai_tokens.note, /mystery-1/);
  assert.equal(r.ai.tokens_7d, 5); // daily summary row is not a call
  assert.ok(!r.ai.by_model_7d.some(m => m.model === 'summary'));
  assert.ok(!JSON.stringify(r).includes('111111111'));
});
