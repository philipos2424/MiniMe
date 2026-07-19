'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

const SERIF = "'Newsreader', Georgia, serif";

const PERIODS = [
  { key: '7d',  label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
];

function fmt(n, currency = 'ETB') {
  if (n == null) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M ${currency}`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k${currency !== 'ETB' ? ' ' + currency : ''}`;
  return `${Number(n).toLocaleString()}${currency !== 'ETB' ? ' ' + currency : ' ETB'}`;
}
function fmtN(n) {
  if (n == null || n === '') return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
function timeAgo(iso) {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function PctBadge({ pct }) {
  if (pct === null || pct === undefined) return null;
  const up = pct >= 0;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
      background: up ? 'rgba(5,150,105,0.1)' : 'rgba(220,38,38,0.1)',
      color: up ? '#059669' : '#DC2626',
      marginLeft: 6,
    }}>
      {up ? '+' : ''}{pct}%
    </span>
  );
}

function Stat({ label, value, sub, accent, href, large }) {
  const inner = (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg, padding: large ? '18px 16px' : '14px',
      boxShadow: SHADOW.card, height: '100%', boxSizing: 'border-box',
    }}>
      <div style={{ fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: COLORS.textHint, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: SERIF, fontSize: large ? 32 : 24, fontWeight: 400, color: accent || COLORS.textPrimary, letterSpacing: '-0.025em', lineHeight: 1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 5, lineHeight: 1.3 }}>{sub}</div>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>{inner}</Link> : inner;
}

// ── Horizontal bar chart ──────────────────────────────────────────────────────
function BarChart({ data, labelKey, valueKey, color, formatVal, maxBars = 8 }) {
  const rows = (data || []).slice(0, maxBars);
  const max = Math.max(...rows.map(r => r[valueKey] || 0), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row, i) => {
        const pct = ((row[valueKey] || 0) / max) * 100;
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: COLORS.textPrimary }}>{row[labelKey]}</span>
              <span style={{ fontSize: 12, color: COLORS.textHint, fontFamily: 'monospace' }}>
                {formatVal ? formatVal(row[valueKey]) : row[valueKey]}
              </span>
            </div>
            <div style={{ height: 5, background: COLORS.border, borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 99, background: color || COLORS.teal, width: `${pct}%`, transition: 'width 0.5s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Mini column chart (for series) ────────────────────────────────────────────
function ColChart({ data, valueKey, color, showLabels = true }) {
  const vals = (data || []).map(d => d[valueKey] || 0);
  const max = Math.max(...vals, 1);
  const step = data?.length > 14 ? Math.ceil(data.length / 7) : 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
      {(data || []).map((d, i) => {
        const pct = (d[valueKey] || 0) / max;
        const label = new Date(d.date).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
        return (
          <div key={i} title={`${label}: ${d[valueKey]}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{
              width: '100%', borderRadius: 3,
              background: d[valueKey] > 0 ? (color || COLORS.teal) : COLORS.border,
              height: Math.max(pct * 68, d[valueKey] > 0 ? 4 : 2),
            }} />
            {showLabels && i % step === 0 && (
              <div style={{ fontSize: 9, color: COLORS.textHint, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {new Date(d.date).toLocaleDateString('en', { day: 'numeric', month: 'short' })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 24-hour heatmap strip ─────────────────────────────────────────────────────
function HourHeatmap({ data }) {
  const max = Math.max(...(data || []).map(h => h.messages), 1);
  return (
    <div>
      <div style={{ display: 'flex', gap: 2 }}>
        {(data || []).map((h, i) => {
          const intensity = h.messages / max;
          return (
            <div key={i} title={`${h.hour}:00 — ${h.messages} msgs`} style={{
              flex: 1, height: 32, borderRadius: 3,
              background: h.messages > 0
                ? `rgba(79,163,138,${0.15 + intensity * 0.85})`
                : COLORS.border,
            }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {[0, 4, 8, 12, 16, 20].map(h => (
          <div key={h} style={{ fontSize: 9.5, color: COLORS.textHint }}>{h}:00</div>
        ))}
      </div>
    </div>
  );
}

// ── Loyalty donut (simple bar breakdown) ─────────────────────────────────────
function LoyaltyBreakdown({ tiers, total }) {
  if (!tiers || total === 0) return <div style={{ fontSize: 13, color: COLORS.textHint }}>No customer data yet.</div>;
  const items = [
    { key: 'gold',   label: '🥇 Gold',   color: '#B08A4A', pts: '500+' },
    { key: 'silver', label: '🥈 Silver', color: '#708090', pts: '100-499' },
    { key: 'bronze', label: '🥉 Bronze', color: '#B87333', pts: '<100' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(it => {
        const count = tiers[it.key] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={it.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13 }}>{it.label} <span style={{ fontSize: 11, color: COLORS.textHint }}>({it.pts} pts)</span></span>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: COLORS.textHint }}>{count} · {pct}%</span>
            </div>
            <div style={{ height: 6, background: COLORS.border, borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 99, background: it.color, width: `${pct}%`, transition: 'width 0.5s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, icon, children, sub }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon && <span style={{ fontSize: 17 }}>{icon}</span>}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.textPrimary, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg, padding: '16px', boxShadow: SHADOW.card,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const { initData } = useTelegram() || {};
  const [period, setPeriod]   = useState('30d');
  const [data, setData]       = useState(null);
  const [topics, setTopics]   = useState(null);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!initData) return;
    setLoading(true);
    let cancelled = false;
    Promise.all([
      fetch(`/api/analytics?period=${period}`, { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' }).then(r => r.json()),
      fetch('/api/analytics/topics', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' }).then(r => r.json()),
      fetch('/api/analytics/insights?days=7', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([a, t, ins]) => {
      if (!cancelled) { setData(a); setTopics(t); setInsights(ins); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [initData, period]);

  const t = data?.totals || {};
  const series = data?.series || [];
  const hoursDisp = t.hours_saved < 1 ? `${Math.round((t.hours_saved || 0) * 60)}m` : `${t.hours_saved}h`;

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.02em', fontFamily: SERIF }}>Analytics</h1>
            <p style={{ fontSize: 12, color: COLORS.textHint, margin: '2px 0 0' }}>Full business performance</p>
          </div>
          {/* Period tabs */}
          <div style={{ display: 'flex', gap: 4, background: COLORS.bg, padding: 3, borderRadius: RADII.md }}>
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)} style={{
                padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: period === p.key ? COLORS.textPrimary : 'transparent',
                color: period === p.key ? '#fff' : COLORS.textHint,
                fontSize: 11.5, fontWeight: 600, fontFamily: FONT.body,
                transition: 'all .15s',
              }}>{p.label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200, color: COLORS.textHint }}>
          Loading…
        </div>
      ) : (
        <div style={{ padding: '16px 20px' }}>

          {/* ── OVERVIEW ── */}
          <Section title="Overview" icon="📊" sub={`${PERIODS.find(p => p.key === period)?.label} vs previous period`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '18px 16px', boxShadow: SHADOW.card }}>
                <div style={{ fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: COLORS.textHint, marginBottom: 4 }}>Hours saved</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 32, color: '#7C3AED', letterSpacing: '-0.025em', lineHeight: 1 }}>{hoursDisp}</div>
                  <PctBadge pct={data?.pct_change?.ai_sent} />
                </div>
                <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 5 }}>{fmtN(t.ai_sent)} AI replies × 2 min</div>
              </div>
              <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '18px 16px', boxShadow: SHADOW.card }}>
                <div style={{ fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: COLORS.textHint, marginBottom: 4 }}>Revenue</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 24, color: '#D97706', letterSpacing: '-0.025em', lineHeight: 1 }}>{fmt(t.revenue, t.currency)}</div>
                  <PctBadge pct={data?.pct_change?.revenue} />
                </div>
                <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 5 }}>{t.paid_orders || 0} paid orders</div>
              </div>
              <Stat label="Chats handled" value={fmtN(t.ai_sent)} sub="by MiniMe automatically" accent={COLORS.teal} />
              <Stat label="New customers" value={fmtN(t.customers_new)} sub={`${fmtN(t.customers_active)} active`} accent={COLORS.green} href="/customers" />
              <Stat label="AI accuracy" value={`${t.accuracy_pct ?? '—'}%`} sub={`${t.edit_rate_pct || 0}% edited`} accent={t.accuracy_pct > 85 ? COLORS.green : COLORS.amber} />
              <Stat label="Avg order" value={t.avg_order_value ? fmt(t.avg_order_value, t.currency) : '—'} sub="per paid order" accent={COLORS.textPrimary} />
              {t.avg_lifetime_value > 0 && (
                <Stat label="Avg lifetime value" value={fmt(t.avg_lifetime_value, t.currency)} sub="revenue per customer" accent="#D97706" />
              )}
            </div>
          </Section>

          {/* ── ACTIVITY TREND ── */}
          {series.length > 0 && (
            <Section title="Activity trend" icon="📈" sub="Messages and revenue over time">
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginBottom: 10, letterSpacing: '0.08em' }}>MESSAGES PER DAY</div>
                <ColChart data={series} valueKey="inbound" color={COLORS.teal} showLabels={series.length <= 30} />
                <div style={{ display: 'flex', gap: 20, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
                  <div>
                    <div style={{ fontFamily: SERIF, fontSize: 20, color: COLORS.teal }}>{fmtN(series.reduce((s, d) => s + d.inbound, 0))}</div>
                    <div style={{ fontSize: 11, color: COLORS.textHint }}>Total messages</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: SERIF, fontSize: 20, color: '#7C3AED' }}>{fmtN(series.reduce((s, d) => s + d.ai_sent, 0))}</div>
                    <div style={{ fontSize: 11, color: COLORS.textHint }}>AI auto-replied</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: SERIF, fontSize: 20, color: '#D97706' }}>{fmt(series.reduce((s, d) => s + d.revenue, 0), t.currency)}</div>
                    <div style={{ fontSize: 11, color: COLORS.textHint }}>Total revenue</div>
                  </div>
                </div>
              </Card>

              <Card style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginBottom: 10, letterSpacing: '0.08em' }}>REVENUE PER DAY</div>
                <ColChart data={series} valueKey="revenue" color="#D97706" showLabels={series.length <= 30} />
              </Card>
            </Section>
          )}

          {/* ── WHEN ARE CUSTOMERS ACTIVE ── */}
          {data?.hour_breakdown && (
            <Section title="When customers message you" icon="🕐" sub="Addis Ababa time (EAT)">
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginBottom: 12, letterSpacing: '0.08em' }}>MESSAGES BY HOUR</div>
                <HourHeatmap data={data.hour_breakdown} />
                {data?.busiest?.hour && data.busiest.hour.messages > 0 && (
                  <div style={{ marginTop: 12, fontSize: 13, color: COLORS.textPrimary }}>
                    🏆 Busiest hour: <strong>{data.busiest.hour.hour}:00–{data.busiest.hour.hour + 1}:00 EAT</strong>
                    <span style={{ color: COLORS.textHint }}> · {data.busiest.hour.messages} messages</span>
                  </div>
                )}
              </Card>

              <Card style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginBottom: 12, letterSpacing: '0.08em' }}>MESSAGES BY DAY OF WEEK</div>
                <BarChart
                  data={data.dow_breakdown}
                  labelKey="day"
                  valueKey="messages"
                  color={COLORS.teal}
                />
                {data?.busiest?.day && (
                  <div style={{ marginTop: 10, fontSize: 13, color: COLORS.textPrimary }}>
                    🏆 Busiest day: <strong>{data.busiest.day.day}</strong>
                    <span style={{ color: COLORS.textHint }}> · {data.busiest.day.messages} messages</span>
                  </div>
                )}
              </Card>
            </Section>
          )}

          {/* ── AI PERFORMANCE ── */}
          <Section title="MiniMe's performance" icon="🤖">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <Stat label="Accuracy" value={`${t.accuracy_pct ?? '—'}%`} sub="replies not edited by you" accent={t.accuracy_pct > 85 ? COLORS.green : COLORS.amber} />
              <Stat label="Auto-sent" value={fmtN(t.ai_sent)} sub="without your review" accent={COLORS.teal} />
              <Stat label="You edited" value={`${t.edit_rate_pct || 0}%`} sub={`${fmtN(t.ai_total)} total AI replies`} accent={COLORS.textPrimary} />
              {t.helpful_pct !== null && t.helpful_pct !== undefined && (
                <Stat label="Helpful rating" value={`${t.helpful_pct}%`} sub={`${t.feedback_count} ratings given`} accent={COLORS.green} />
              )}
            </div>
            {t.hours_saved > 0 && (
              <Card style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div style={{ fontSize: 36 }}>⏰</div>
                  <div>
                    <div style={{ fontFamily: SERIF, fontSize: 28, color: '#7C3AED', letterSpacing: '-0.02em' }}>{hoursDisp}</div>
                    <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
                      saved from manual replies · equivalent to {Math.round((t.hours_saved || 0) / 8 * 10) / 10} working days
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </Section>

          {/* ── CUSTOMERS ── */}
          <Section title="Customers" icon="👥">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <Stat label="Total customers" value={fmtN(t.customers_total)} sub="all time" accent={COLORS.textPrimary} href="/customers" />
              <Stat label="Active" value={fmtN(t.customers_active)} sub={`in last ${data?.days || 30} days`} accent={COLORS.teal} />
              <Stat label="New" value={fmtN(t.customers_new)} sub="joined this period" accent={COLORS.green} />
              <Stat label="Repeat rate" value={`${t.repeat_rate_pct ?? '—'}%`} sub="of buyers ordered again" accent={t.repeat_rate_pct > 40 ? COLORS.green : COLORS.amber} />
            </div>

            {/* AI Customer Insights */}
            {insights?.insights && (
              <Card style={{ marginTop: 10, background: 'linear-gradient(135deg, #0E2823 0%, #1a3830 100%)', border: 'none' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(251,248,241,0.5)', marginBottom: 10, letterSpacing: '0.08em' }}>🧠 WHAT CUSTOMERS WANT THIS WEEK</div>
                <p style={{ fontSize: 13, color: 'rgba(251,248,241,0.85)', lineHeight: 1.5, margin: '0 0 12px' }}>
                  {insights.insights.summary}
                </p>
                {insights.insights.top_requests?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: 'rgba(251,248,241,0.4)', marginBottom: 6, fontWeight: 600 }}>MOST REQUESTED</div>
                    {insights.insights.top_requests.slice(0, 4).map((r, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'rgba(251,248,241,0.75)', padding: '3px 0', display: 'flex', gap: 6 }}>
                        <span style={{ color: '#B08A4A', flexShrink: 0 }}>•</span>{r}
                      </div>
                    ))}
                  </div>
                )}
                {insights.insights.missing_from_catalog?.length > 0 && (
                  <div style={{ marginBottom: 10, padding: '10px 12px', background: 'rgba(176,138,74,0.15)', borderRadius: 10, border: '1px solid rgba(176,138,74,0.3)' }}>
                    <div style={{ fontSize: 11, color: '#D4B060', fontWeight: 700, marginBottom: 5 }}>⚠️ CUSTOMERS ASKED FOR THESE — NOT IN YOUR CATALOG</div>
                    {insights.insights.missing_from_catalog.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'rgba(251,248,241,0.75)', padding: '2px 0' }}>• {r}</div>
                    ))}
                  </div>
                )}
                {insights.insights.action_items?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: 'rgba(251,248,241,0.4)', marginBottom: 6, fontWeight: 600 }}>THIS WEEK'S ACTIONS</div>
                    {insights.insights.action_items.map((a, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'rgba(251,248,241,0.75)', padding: '3px 0', display: 'flex', gap: 6 }}>
                        <span style={{ color: '#4FA38A', flexShrink: 0 }}>{i + 1}.</span>{a}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Loyalty breakdown */}
            <Card style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginBottom: 12, letterSpacing: '0.08em' }}>LOYALTY TIER BREAKDOWN</div>
              <LoyaltyBreakdown tiers={data?.tier_breakdown} total={t.customers_total} />
            </Card>

            {/* Top customers */}
            {data?.topCustomers?.length > 0 && (
              <Card style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginBottom: 12, letterSpacing: '0.08em' }}>TOP CUSTOMERS BY SPEND</div>
                {data.topCustomers.map((c, i) => (
                  <Link key={c.id} href={`/customers/${c.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
                      borderBottom: i < data.topCustomers.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                    }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                        background: COLORS.bg, display: 'grid', placeItems: 'center',
                        fontFamily: SERIF, fontSize: 16, color: COLORS.textPrimary,
                      }}>
                        {(c.name || '?')[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: COLORS.textHint }}>{c.total_orders} orders · {timeAgo(c.last_active)}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{fmt(c.total_spent, t.currency)}</div>
                        <div style={{ fontSize: 10, color: COLORS.textHint }}>{c.loyalty_points} pts</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </Card>
            )}
          </Section>

          {/* ── REVENUE ── */}
          <Section title="Revenue & orders" icon="💰">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <Stat label="Total revenue" value={fmt(t.revenue, t.currency)} sub={`${t.paid_orders || 0} paid orders`} accent="#D97706" href="/orders" />
              <Stat label="Avg order value" value={t.avg_order_value ? fmt(t.avg_order_value, t.currency) : '—'} sub="per paid order" accent={COLORS.textPrimary} />
              <Stat label="All orders" value={fmtN(t.orders)} sub="created in period" accent={COLORS.textPrimary} />
              {t.pipeline_etb > 0 && (
                <Stat label="Open pipeline" value={fmt(t.pipeline_etb, 'ETB')} sub="active jobs" accent={COLORS.teal} href="/pipeline" />
              )}
            </div>
          </Section>

          {/* ── STOCK VELOCITY ALERTS ── */}
          {data?.velocity_alerts?.length > 0 && (
            <Section title="Running out soon" icon="⚠️" sub="At current sales rate">
              <Card>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.velocity_alerts.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 2 }}>
                          {p.stock} in stock · sells {p.daily_rate}/day
                        </div>
                      </div>
                      <div style={{
                        fontSize: 13, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
                        background: p.days_left <= 2 ? 'rgba(184,84,80,0.1)' : 'rgba(176,138,74,0.1)',
                        color: p.days_left <= 2 ? COLORS.red : '#B08A4A',
                      }}>
                        {p.days_left}d left
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>
          )}

          {/* ── MINIME MARKET — proof it's working + what to stock next ── */}
          {(data?.totals?.market_views > 0 || data?.totals?.market_clicks > 0
            || data?.market?.hot_products?.length > 0 || data?.market?.unmet_demand?.length > 0) ? (
            <Section title="MiniMe Market" icon="🛍️" sub="Shoppers discovering you on the marketplace — free traffic, no ads">
              <Card>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1, textAlign: 'center', padding: '14px 8px', background: 'rgba(79,163,138,0.07)', borderRadius: 12 }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: COLORS.textPrimary }}>{data.totals.market_views || 0}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.textSecondary, marginTop: 2 }}>👀 Product views</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', padding: '14px 8px', background: 'rgba(217,119,6,0.08)', borderRadius: 12 }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: '#D97706' }}>{data.totals.market_clicks || 0}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.textSecondary, marginTop: 2 }}>🛒 Order taps</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 10 }}>
                  People who tapped Order landed in your chat — check Chats. Good photos and clear prices lift both numbers.
                </div>

                {/* Your products people are eyeing — concrete proof Market works */}
                {data?.market?.hot_products?.length > 0 && (
                  <div style={{ marginTop: 16, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 10 }}>
                      🔥 Your products shoppers are eyeing
                    </div>
                    {data.market.hot_products.map(p => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ fontSize: 11.5, color: COLORS.textSecondary, flexShrink: 0 }}>
                          {p.views} view{p.views === 1 ? '' : 's'}{p.clicks > 0 ? ` · ${p.clicks} order tap${p.clicks === 1 ? '' : 's'}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Unmet demand — the persuasive "add this and get found" hit-list */}
                {data?.market?.unmet_demand?.length > 0 && (
                  <div style={{ marginTop: 16, borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 3 }}>
                      💡 Shoppers searched for these — and found nothing
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 10 }}>
                      Add or stock any of these and you'll be the shop that shows up.
                    </div>
                    {data.market.unmet_demand.map((d, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          "{d.query}"
                        </div>
                        <div style={{ fontSize: 11.5, color: '#D97706', fontWeight: 600, flexShrink: 0 }}>
                          {d.searches > 0 ? `${d.searches} search${d.searches === 1 ? '' : 'es'}` : ''}
                          {d.waiting > 0 ? `${d.searches > 0 ? ' · ' : ''}${d.waiting} waiting` : ''}
                        </div>
                      </div>
                    ))}
                    <Link href="/products" style={{
                      display: 'inline-block', marginTop: 10, fontSize: 12.5, fontWeight: 600,
                      color: COLORS.teal, textDecoration: 'none',
                    }}>
                      Add a product →
                    </Link>
                  </div>
                )}
              </Card>
            </Section>
          ) : (
            <Section title="MiniMe Market" icon="🛍️" sub="Your free storefront on the marketplace">
              <Card>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.55 }}>
                  No marketplace views yet. Once your products are listed, shoppers searching MiniMe Market can discover your shop — free traffic, no ads.
                </div>
                <Link href="/settings/search" style={{
                  display: 'inline-block', marginTop: 12, fontSize: 12.5, fontWeight: 600,
                  color: COLORS.teal, textDecoration: 'none',
                }}>
                  Check your Market listing →
                </Link>
              </Card>
            </Section>
          )}

          {/* ── TOP PRODUCTS ── */}
          {data?.topProducts?.length > 0 && (
            <Section title="Top products by revenue" icon="🏆" sub="From paid orders in this period">
              <Card>
                <BarChart
                  data={data.topProducts}
                  labelKey="name"
                  valueKey="revenue"
                  color="#D97706"
                  formatVal={v => `${Number(v).toLocaleString()} ETB`}
                  maxBars={8}
                />
              </Card>
            </Section>
          )}

          {/* ── WHAT CUSTOMERS ASK ── */}
          {topics && (topics.topics?.length > 0 || topics.intents?.length > 0) && (
            <Section title="What customers ask about" icon="💬" sub="Last 30 days">
              <Card>
                {topics.total > 0 && (
                  <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 14 }}>
                    {topics.total} inbound messages analysed
                  </div>
                )}
                {topics.topics?.length > 0 && (
                  <BarChart
                    data={topics.topics}
                    labelKey="label"
                    valueKey="count"
                    color={COLORS.teal}
                    formatVal={n => `${n}×`}
                  />
                )}
                {topics.intents?.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', margin: '16px 0 8px' }}>INTENT BREAKDOWN</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {topics.intents.map(({ label, count }) => (
                        <span key={label} style={{
                          fontSize: 12, padding: '4px 10px', borderRadius: 999,
                          background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                          color: COLORS.textSecondary,
                        }}>
                          {label} <span style={{ fontSize: 10, fontFamily: 'monospace', color: COLORS.textHint }}>{count}</span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            </Section>
          )}

          {/* Export note */}
          <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 12, color: COLORS.textHint }}>
            Live data · refreshes each visit
          </div>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
