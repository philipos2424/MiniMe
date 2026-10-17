'use client';
/**
 * Admin → Insights. One payload from /api/admin/insights (aggregates only —
 * see lib/server/metrics/insights.mjs for every definition and the privacy
 * contract). Sections are ordered by the question they answer:
 * broken? → growing? → money? → where do shops drop off? → system cost? → compliant?
 */
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';

const SERIF = "'Fraunces', Georgia, serif";
const MONO = "'JetBrains Mono', monospace";
const C = {
  ink: '#3D2817', muted: '#8A7560', line: '#E8DFD0', card: '#FFFFFF', accent: '#8B2E1F',
  good: '#2F7D5B', warn: '#B7791F', bad: '#B42318', s1: '#8B2E1F', s2: '#4FA38A', s3: '#C9A227', s4: '#8A7560',
};
const RANGES = [7, 30, 90, 365];

const fmt = (v, unit = '') => {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (unit === '%') return `${v}%`;
  if (unit === 'ETB') return `${Math.round(v).toLocaleString('en-US')} ETB`;
  if (unit === '$') return `$${v.toLocaleString('en-US', { maximumFractionDigits: 3 })}`;
  if (unit === 's') return v < 90 ? `${v}s` : `${Math.round(v / 60)}m`;
  return Number(v).toLocaleString('en-US');
};
const label = s => String(s).replace(/_/g, ' ');

function Section({ title, question, children, right }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.muted }}>{title}</div>
          <div style={{ fontFamily: SERIF, fontSize: 19, color: C.ink, marginTop: 2 }}>{question}</div>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 4, padding: 14, ...style }}>{children}</div>;
}

function Grid({ min = 170, children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 10 }}>{children}</div>;
}

/** lowerIsBetter flips the delta colour (failure rates, latency). */
function Tile({ name, value, unit, change, lowerIsBetter, hint, tone }) {
  const up = change > 0, good = lowerIsBetter ? !up : up;
  const color = tone ? C[tone] : C.ink;
  return (
    <Card>
      <div style={{ fontSize: 11.5, color: C.muted }}>{name}</div>
      <div style={{ fontFamily: SERIF, fontSize: 24, color, marginTop: 4 }}>{fmt(value, unit)}</div>
      {change != null && change !== 0 && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: good ? C.good : C.bad, marginTop: 2 }}>
          {up ? '▲' : '▼'} {Math.abs(change)}% vs prev
        </div>
      )}
      {hint && <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.35 }}>{hint}</div>}
    </Card>
  );
}

function Table({ cols, rows, empty = 'Nothing here.' }) {
  if (!rows?.length) return <div style={{ fontSize: 13, color: C.muted, padding: 8 }}>{empty}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>{cols.map(c => <th key={c.k} style={{ textAlign: c.num ? 'right' : 'left', fontWeight: 500, color: C.muted, padding: '6px 8px', borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }}>{c.l}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || r.key || r.model || r.action || i}>
              {cols.map(c => (
                <td key={c.k} style={{ textAlign: c.num ? 'right' : 'left', padding: '6px 8px', borderBottom: `1px solid ${C.line}`, color: C.ink, fontFamily: c.num ? MONO : 'inherit', whiteSpace: c.wrap ? 'normal' : 'nowrap' }}>
                  {c.render ? c.render(r) : fmt(r[c.k], c.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Funnel({ steps }) {
  return (
    <div>
      {steps.map((s, i) => (
        <div key={s.step} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 110px', alignItems: 'center', gap: 10, padding: '5px 0' }}>
          <div style={{ fontSize: 12.5, color: C.ink }}>{label(s.step)}</div>
          <div style={{ background: '#F5EFE6', borderRadius: 2, height: 16 }}>
            <div style={{ width: `${Math.min(100, s.pct_of_top || 0)}%`, background: i === 0 ? C.s4 : C.s1, height: 16, borderRadius: 2, minWidth: s.count ? 2 : 0 }} />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, textAlign: 'right', color: C.ink }}>
            {fmt(s.count)}{s.pct_of_prev != null && <span style={{ color: s.pct_of_prev < 50 ? C.bad : C.muted }}> · {s.pct_of_prev}%</span>}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>% = conversion from the step above. Red = under half made it.</div>
    </div>
  );
}

function Cohorts({ rows }) {
  const max = Math.max(...rows.map(r => r.retention_pct.length));
  const bg = v => (v == null ? 'transparent' : `rgba(139,46,31,${0.08 + Math.min(1, v / 60) * 0.75})`);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: MONO }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px', color: C.muted, fontWeight: 500 }}>Signup week</th>
            <th style={{ padding: '4px 8px', color: C.muted, fontWeight: 500 }}>Shops</th>
            {Array.from({ length: max }, (_, k) => <th key={k} style={{ padding: '4px 6px', color: C.muted, fontWeight: 500 }}>W{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.week}>
              <td style={{ padding: '3px 8px', color: C.ink }}>{r.week}</td>
              <td style={{ padding: '3px 8px', textAlign: 'right', color: C.ink }}>{r.size}</td>
              {Array.from({ length: max }, (_, k) => {
                const v = r.retention_pct[k];
                return <td key={k} style={{ padding: '3px 6px', textAlign: 'center', background: bg(v), color: v > 35 ? '#fff' : C.ink, minWidth: 36 }}>{v == null ? '' : `${Math.round(v)}`}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>% of each week's new shops with customer messages or an owner session in week N after signup.</div>
    </div>
  );
}

function Chart({ data, height = 240, children }) {
  return (
    <Card style={{ padding: '14px 6px 6px' }}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ left: 0, right: 12, top: 4 }}>
          <CartesianGrid stroke={C.line} vertical={false} />
          <XAxis dataKey="d" tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.line }} minTickGap={18} />
          <YAxis tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} width={40} />
          <Tooltip contentStyle={{ fontSize: 12, border: `1px solid ${C.line}` }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {children}
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

function Dist({ data, colors }) {
  const rows = Object.entries(data || {}).map(([k, v]) => ({ k: label(k), v })).sort((a, b) => b.v - a.v);
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 28)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 10, right: 30 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="k" width={110} tick={{ fontSize: 11, fill: C.ink }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="v" name="shops" fill={colors || C.s1} label={{ position: 'right', fontSize: 11, fill: C.ink }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function InsightsPanel({ initData, onPick }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load(n = days) {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/insights?days=${n}`, { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Insights failed (${r.status})`);
      setData(j);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { if (initData) load(days); }, [initData, days]);

  const controls = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {RANGES.map(n => (
        <button key={n} onClick={() => setDays(n)} style={{
          appearance: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 11, padding: '5px 10px', borderRadius: 4,
          border: `1px solid ${days === n ? C.accent : C.line}`, background: days === n ? C.accent : C.card, color: days === n ? '#fff' : C.muted,
        }}>{n === 365 ? '1y' : `${n}d`}</button>
      ))}
      <button onClick={() => load()} disabled={loading} style={{ appearance: 'none', cursor: 'pointer', fontSize: 11.5, padding: '5px 10px', borderRadius: 4, border: `1px solid ${C.line}`, background: C.card, color: C.muted }}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    </div>
  );

  if (err) return <Card style={{ borderColor: '#FDBA74', background: '#FFF7ED', color: '#9A3412' }}>Insights failed to load: {err} <button onClick={() => load()} style={{ marginLeft: 8 }}>Retry</button></Card>;
  if (!data) return <div style={{ padding: 24, color: C.muted, fontFamily: MONO, fontSize: 12 }}>Loading insights…</div>;

  const { today, kpis: k, money, funnel, activation, cohorts, engagement: eng, buyers, ai, segments, privacy } = data;
  const series = data.series.map(d => ({ ...d, d: d.day.slice(5) + (d.partial ? '*' : '') }));
  const hasBackfill = series.some(d => d.backfill);
  const pickShop = id => onPick && onPick({ id });
  const shopName = r => onPick
    ? <button onClick={() => pickShop(r.id)} style={{ appearance: 'none', border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: C.accent, fontFamily: 'inherit', fontSize: 'inherit', textAlign: 'left' }}>{r.name}</button>
    : r.name;

  return (
    <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: C.muted }}>
          {data.range.from} → {data.range.to} (EAT) · compared with the {data.range.days} days before · rollup {today.rollup.age_hours != null ? `${today.rollup.age_hours} h old` : 'missing'}
        </div>
        {controls}
      </div>

      <Card style={{ marginBottom: 22, background: '#F4F8F6', borderColor: '#CFE3D9', fontSize: 12, color: '#24513F', lineHeight: 1.5 }}>
        🔒 <b>Aggregates only.</b> No message text, buyer identities, owner names, phones, @handles or Telegram IDs leave the server.
        Shops are shown by shop name; open one to see its detail under the existing audited admin view. No third-party analytics.
      </Card>

      {/* 1 ─ Today */}
      <Section title="Today" question="Is anything broken or waiting on me?">
        {today.alerts.length > 0 && (
          <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
            {today.alerts.map((a, i) => (
              <div key={i} style={{ padding: '8px 12px', borderRadius: 4, fontSize: 13, background: a.level === 'danger' ? '#FEF3F2' : '#FFFAEB', border: `1px solid ${a.level === 'danger' ? '#FECDCA' : '#FEDF89'}`, color: a.level === 'danger' ? C.bad : '#93370D' }}>
                {a.level === 'danger' ? '●' : '▲'} {a.text}
              </div>
            ))}
          </div>
        )}
        <Grid min={150}>
          <Tile name="Signups today" value={today.signups_today} hint={`Same day last week: ${today.signups_same_weekday_last_week}`} />
          <Tile name="Live shops (24 h)" value={today.live_shops_24h} hint={`${fmt(today.inbound_24h)} customer messages`} />
          <Tile name="Delivery failures (24 h)" value={today.delivery_fail_pct_24h} unit="%" tone={today.delivery_fail_pct_24h >= 5 ? 'bad' : undefined} />
          <Tile name="AI chain failures (24 h)" value={today.llm_fail_pct_24h} unit="%" tone={today.llm_fail_pct_24h >= 10 ? 'bad' : undefined} hint={`${fmt(today.llm_calls_24h)} calls`} />
          <Tile name="Payments to verify" value={today.payments_awaiting_review} tone={today.payments_awaiting_review ? 'warn' : undefined} hint="See 💳 Payments" />
          <Tile name="Rollup freshness" value={today.rollup.age_hours != null ? `${today.rollup.age_hours} h` : '—'} tone={today.rollup.stale ? 'bad' : 'good'} hint={today.rollup.stale ? 'Stale — check cron' : 'Nightly 02:00 EAT'} />
        </Grid>
      </Section>

      {/* 2 ─ Growth KPIs */}
      <Section title={`Last ${data.range.days} days`} question="Is the platform growing?">
        <Grid>
          <Tile name="New shops" value={k.signups.value} change={k.signups.change_pct} />
          <Tile name="Live shops" value={k.live_shops.value} change={k.live_shops.change_pct} hint="≥1 customer message" />
          <Tile name="Engaged owners" value={k.engaged_owners.value} change={k.engaged_owners.change_pct} hint="≥1 dashboard session" />
          <Tile name="Customer messages" value={k.inbound_messages.value} change={k.inbound_messages.change_pct} />
          <Tile name="New buyers" value={k.new_buyers.value} change={k.new_buyers.change_pct} />
          <Tile name="AI share of replies" value={k.ai_reply_share_pct.value} unit="%" change={k.ai_reply_share_pct.change_pct} />
          <Tile name="Delivery failure rate" value={k.delivery_fail_pct.value} unit="%" change={k.delivery_fail_pct.change_pct} lowerIsBetter />
          <Tile name="Orders created" value={k.orders_created.value} change={k.orders_created.change_pct} hint={`${fmt(k.orders_paid.value)} paid`} />
          <Tile name="GMV (paid orders)" value={k.gmv_etb.value} unit="ETB" change={k.gmv_etb.change_pct} />
        </Grid>
        <div style={{ height: 12 }} />
        <Chart data={series}>
          <Bar isAnimationActive={false} dataKey="inbound" name="customer msgs" fill={C.s2} opacity={0.85} />
          <Bar isAnimationActive={false} dataKey="failed" name="failed sends" fill={C.bad} />
          <Line isAnimationActive={false} dataKey="live_shops" name="live shops" stroke={C.s1} dot={false} strokeWidth={2} />
          <Line isAnimationActive={false} dataKey="engaged_owners" name="engaged owners" stroke={C.s3} dot={false} strokeWidth={2} />
          <Line isAnimationActive={false} dataKey="signups" name="signups" stroke={C.s4} dot={false} strokeDasharray="4 3" />
        </Chart>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
          * = today, partial.{hasBackfill && ' Some days were backfilled from history (owner sessions only exist for the last 90 days).'}
        </div>
      </Section>

      {/* 3 ─ Money */}
      <Section title="Money" question="Is money coming in, and how reliably?">
        <Grid>
          <Tile name="Paying shops" value={money.paying_shops} hint="Verified paid + claimed" />
          <Tile name="MRR (estimate)" value={money.mrr_estimate_etb} unit="ETB" hint={money.mrr_basis} />
          <Tile name="Granted, unpaid" value={money.granted_unpaid} tone={money.granted_unpaid ? 'warn' : undefined} hint="Pro access with no payment record — reconcile" />
          <Tile name="Wanted to pay" value={money.wanted_to_pay} hint="Asked for details, never completed — follow up" />
          <Tile name="Trials ending in 7 d" value={money.trials_ending_7d} />
          <Tile name="Trial → paid" value={money.trial_to_paid_pct} unit="%" hint={`${money.trials_ended_in_range} trials ended in range`} />
          <Tile name="Subscribed / expired" value={`${money.events.subscribed} / ${money.events.expired}`} hint="Subscription events in range" />
        </Grid>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10, marginTop: 10 }}>
          <Card><div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Entitlement (what shops can use)</div><Dist data={money.plan_states} colors={C.s2} /></Card>
          <Card><div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Payment state (has anyone paid)</div><Dist data={money.payment_states} /></Card>
        </div>
      </Section>

      {/* 4 ─ Growth & behaviour */}
      <Section title="Growth & behaviour" question="Where do shops drop off?">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
          <Card>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Owner onboarding — people who reached each step (or beyond)</div>
            <Funnel steps={funnel.onboarding} />
          </Card>
          <Card>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Shops created in range → value</div>
            <Funnel steps={funnel.shops} />
            <div style={{ marginTop: 14, fontSize: 13, color: C.ink }}>
              <b>Activation</b> (first customer message within 7 days): <span style={{ fontFamily: MONO }}>{fmt(activation.rate_pct, '%')}</span>
              <span style={{ color: C.muted }}> · {activation.activated}/{activation.matured_signups} shops at least 7 days old</span>
            </div>
          </Card>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10, marginTop: 10 }}>
          {[['by_source', 'Activation by acquisition source'], ['by_category', 'Activation by category']].map(([key, t]) => (
            <Card key={key}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{t}</div>
              <Table rows={activation[key]} cols={[
                { k: 'key', l: 'Group', render: r => label(r.key) },
                { k: 'signups', l: 'Shops', num: true },
                { k: 'activated', l: 'Activated', num: true },
                { k: 'rate_pct', l: 'Rate', num: true, render: r => <span style={{ color: r.low_n ? C.muted : C.ink }}>{fmt(r.rate_pct, '%')}{r.low_n ? ' (low n)' : ''}</span> },
              ]} />
            </Card>
          ))}
        </div>
        <Card style={{ marginTop: 10 }}><Cohorts rows={cohorts} /></Card>
        <div style={{ marginTop: 10 }}>
          <Grid>
            <Tile name="Owner DAU (7-day avg)" value={eng.dau_avg_7d} />
            <Tile name="Owner WAU" value={eng.wau} />
            <Tile name="Owner MAU" value={eng.mau} />
            <Tile name="Stickiness (DAU/MAU)" value={eng.stickiness_pct} unit="%" hint={eng.note} />
          </Grid>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Screen-by-screen feature adoption is on the 👆 Usage tab.</div>
        </div>
      </Section>

      {/* 5 ─ Buyers */}
      <Section title="Buyers (aggregate)" question="Are customers being served well?">
        <Grid>
          <Tile name="Buyers active in range" value={buyers.active_in_range} hint={`${fmt(buyers.total)} total`} />
          <Tile name="Returning buyers" value={buyers.returning_pct} unit="%" hint={`${fmt(buyers.returning_in_range)} came back`} />
          <Tile name="Median first reply" value={buyers.reply_p50_s} unit="s" hint={`p90 ${fmt(buyers.reply_p90_s, 's')}`} />
          <Tile name="Replied within 1 min" value={buyers.reply_under_1m_pct} unit="%" hint={`within 5 min: ${fmt(buyers.reply_under_5m_pct, '%')}`} />
          <Tile name="Orders per 100 msgs" value={buyers.orders_per_100_inbound} />
          <Tile name="Avg paid order" value={buyers.avg_order_value_etb} unit="ETB" />
          <Tile name="Broadcast opt-outs" value={buyers.opt_out_pct} unit="%" hint={`${fmt(buyers.opted_out)} buyers`} />
        </Grid>
      </Section>

      {/* 6 ─ AI & Ops */}
      <Section title="AI & Ops" question="Is the system healthy, and what does it cost?">
        <Grid>
          <Tile name="AI chain calls" value={ai.calls} />
          <Tile name="Chain failure rate" value={ai.fail_pct} unit="%" tone={ai.fail_pct >= 10 ? 'bad' : undefined} hint="Whole provider chain failed" />
          <Tile name="AI cost" value={ai.cost_reported ? ai.cost_usd : 'not reported'} unit={ai.cost_reported ? '$' : ''} hint={ai.cost_reported ? `${fmt(ai.cost_per_live_shop_usd, '$')} per live shop` : 'Current providers log $0 — not real cost'} />
          <Tile name="Cost per paying shop" value={ai.cost_reported ? money.ai_cost_per_paying_shop_usd : null} unit="$" />
        </Grid>
        <div style={{ height: 10 }} />
        <Chart data={series} height={200}>
          <Area isAnimationActive={false} dataKey="llm_calls" name="AI calls" fill={C.s2} stroke={C.s2} fillOpacity={0.25} />
          <Bar isAnimationActive={false} dataKey="llm_failed" name="failed" fill={C.bad} />
        </Chart>
        <Card style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>By model, last 7 days (chain outcomes)</div>
          <Table rows={ai.by_model_7d} cols={[
            { k: 'model', l: 'Model' },
            { k: 'calls', l: 'Calls', num: true },
            { k: 'fail_pct', l: 'Failed', num: true, render: r => <span style={{ color: r.fail_pct >= 10 ? C.bad : C.ink }}>{fmt(r.fail_pct, '%')}</span> },
            { k: 'p50_ms', l: 'p50 ms', num: true },
            { k: 'p95_ms', l: 'p95 ms', num: true },
          ]} />
        </Card>
      </Section>

      {/* 7 ─ Shops */}
      <Section title="Shops" question="Who needs attention?">
        <Grid min={150}>
          <Tile name="Active (7 d)" value={segments.counts.active} tone="good" />
          <Tile name="At risk" value={segments.counts.at_risk} tone={segments.counts.at_risk ? 'warn' : undefined} hint="Live in last 30 d, silent 7 d" />
          <Tile name="Dormant" value={segments.counts.dormant} hint="Silent 30 d+" />
          <Tile name="Never live" value={segments.counts.never_live} hint="No customer message yet" />
        </Grid>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 10, marginTop: 10 }}>
          <Card>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>At risk — went quiet this week (save these first)</div>
            <Table rows={segments.at_risk} empty="No shop went quiet this week." cols={[
              { k: 'name', l: 'Shop', render: shopName, wrap: true },
              { k: 'last_active_day', l: 'Last msg', render: r => r.last_active_day },
              { k: 'inbound_prev_30d', l: 'Msgs 30 d', num: true },
              { k: 'plan_state', l: 'Plan', render: r => r.plan_state },
            ]} />
          </Card>
          <Card>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Top shops by customer messages</div>
            <Table rows={segments.top_shops} cols={[
              { k: 'name', l: 'Shop', render: shopName, wrap: true },
              { k: 'inbound', l: 'Msgs', num: true },
              { k: 'orders_paid', l: 'Paid orders', num: true },
              { k: 'reply_p50_s', l: 'Reply', num: true, unit: 's' },
              { k: 'owner_sessions', l: 'Owner sessions', num: true },
            ]} />
          </Card>
        </div>
        <Card style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Active shops by category</div>
          <Dist data={Object.fromEntries(segments.active_by_category.map(c => [c.category, c.count]))} colors={C.s2} />
        </Card>
      </Section>

      {/* 8 ─ Trust & privacy */}
      <Section title="Trust & privacy" question="Are we compliant?">
        <Grid>
          <Tile name="Owners with consent recorded" value={privacy.owners_with_consent_pct} unit="%" tone={privacy.owners_with_consent_pct < 95 ? 'warn' : 'good'} />
          <Tile name="Owners opted out of nudges" value={privacy.owner_nudge_opt_outs} hint="Excluded from owner messaging" />
          <Tile name="Owners who blocked the bot" value={privacy.owner_bot_blocked} />
          <Tile name="Buyers opted out of broadcasts" value={privacy.buyer_opt_outs} />
        </Grid>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10, marginTop: 10 }}>
          <Card>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Personal-data access by admins, last 30 days (from audit log)</div>
            <Table rows={privacy.sensitive_admin_actions_30d} empty="No sensitive admin actions." cols={[
              { k: 'action', l: 'Action' }, { k: 'count', l: 'Times', num: true },
            ]} />
          </Card>
          <Card>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Retention policy</div>
            <Table rows={privacy.retention} cols={[{ k: 'data', l: 'Data', wrap: true }, { k: 'keep', l: 'Kept for', wrap: true }]} />
          </Card>
        </div>
      </Section>

      <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textAlign: 'right' }}>generated {new Date(data.generated_at).toLocaleString()}</div>
    </div>
  );
}
