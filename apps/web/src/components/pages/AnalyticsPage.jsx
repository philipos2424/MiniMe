'use client';
/**
 * Analytics page — redesigned v2.
 * Now shows: hours saved, chats handled (all-time + weekly), revenue, top customers.
 * Beautiful stat cards with icons.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import WeeklyChart from '../analytics/WeeklyChart';
import TopCustomers from '../analytics/TopCustomers';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

const MINS_PER_CHAT = 2; // estimated minutes saved per AI reply

export default function AnalyticsPage() {
  const { initData } = useTelegram() || {};
  const [data, setData] = useState(null);
  const [topics, setTopics] = useState(null);

  useEffect(() => {
    if (!initData) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/analytics', {
          headers: { 'x-telegram-init-data': initData },
          cache: 'no-store',
        });
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [initData]);

  useEffect(() => {
    if (!initData) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/analytics/topics', {
          headers: { 'x-telegram-init-data': initData },
          cache: 'no-store',
        });
        const j = await r.json();
        if (!cancelled) setTopics(j);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [initData]);

  if (!data) return <AnalyticsSkeleton />;

  const { weekly = [], totals = {}, topCustomers = [] } = data;
  const aiSent = totals.aiSent || 0;
  const hoursSaved = Math.round((aiSent * MINS_PER_CHAT / 60) * 10) / 10;
  const hoursSavedDisplay = hoursSaved < 1 ? `${Math.round(hoursSaved * 60)}m` : `${hoursSaved}h`;
  const editRate = totals.edit_rate_pct || 0;
  const accuracyPct = Math.max(0, 100 - editRate);

  const hoursTagline =
    hoursSaved < 0.5  ? 'Every minute adds up.'         :
    hoursSaved < 4    ? 'A few hours back to you.'       :
    hoursSaved < 8    ? 'Half a workday — back to you.'  :
                        'A full workday — back to you.'  ;

  return (
    <div style={{
      background: COLORS.bg, minHeight: '100vh', paddingBottom: 100,
      fontFamily: FONT.body, color: COLORS.textPrimary,
    }}>
      {/* Header */}
      <div style={{ padding: '20px 20px 0' }}>
        <h1 style={{ fontSize: 26, fontWeight: 400, margin: 0, color: COLORS.textPrimary, letterSpacing: '-0.025em', fontFamily: "'Fraunces', Georgia, serif" }}>Analytics</h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 4 }}>Last 7 days · live</p>
      </div>

      <div style={{ padding: '16px 20px' }}>
        {/* Hero: hours saved + chats handled */}
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>THIS WEEK'S IMPACT</SectionLabel>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <HeroCard
              icon="⏰"
              value={hoursSavedDisplay}
              label="hours saved"
              sub={`${aiSent} AI replies × ${MINS_PER_CHAT}min`}
              gradient="linear-gradient(135deg, #7C3AED, #6D28D9)"
              tagline={hoursTagline}
            />
            <HeroCard
              icon="💬"
              value={aiSent}
              label="chats handled"
              sub="by MiniMe automatically"
              gradient={`linear-gradient(135deg, ${COLORS.teal}, #0F766E)`}
            />
          </div>
        </div>

        {/* Secondary stats grid */}
        <SectionLabel>PERFORMANCE</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10, marginBottom: 20 }}>
          <StatCard icon="🎯" label="AI Accuracy" value={`${accuracyPct}%`} sub={`${editRate}% edited by you`} accent={accuracyPct > 85 ? COLORS.green : COLORS.amber} />
          <StatCard icon="👥" label="Total Clients" value={(totals.total_customers || 0).toLocaleString()} sub="all time" accent={COLORS.teal} />
          <StatCard icon="💰" label="Revenue (7d)" value={`${(totals.revenue || 0).toLocaleString()}`} sub="ETB · paid orders" accent="#D97706" />
          <StatCard icon="📥" label="New Clients" value={totals.newCustomers || 0} sub="this week" accent={COLORS.green} />
        </div>

        {/* Pipeline */}
        {(totals.pipeline_etb > 0 || totals.pipeline_usd > 0 || totals.open_jobs > 0) && (
          <>
            <SectionLabel>OPEN PIPELINE</SectionLabel>
            <div style={{ display: 'flex', gap: 10, marginTop: 10, marginBottom: 20 }}>
              {totals.pipeline_etb > 0 && (
                <StatCard icon="📋" label="Pipeline ETB" value={(totals.pipeline_etb).toLocaleString()} sub={`${totals.open_jobs || 0} open jobs`} accent="#D97706" />
              )}
              {totals.pipeline_usd > 0 && (
                <StatCard icon="💵" label="Pipeline USD" value={`$${(totals.pipeline_usd).toLocaleString()}`} sub="in progress" accent={COLORS.green} />
              )}
            </div>
          </>
        )}

        {/* Weekly chart */}
        {weekly.length > 0 && (
          <>
            <SectionLabel>WEEKLY ACTIVITY</SectionLabel>
            <div style={{ marginTop: 10, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px', boxShadow: SHADOW.card, marginBottom: 20, overflow: 'hidden' }}>
              <WeeklyChart data={weekly} />
            </div>
          </>
        )}

        {/* Hours saved per day bar chart */}
        {weekly.length > 0 && (
          <>
            <SectionLabel>HOURS SAVED PER DAY</SectionLabel>
            <div style={{ marginTop: 10, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px', boxShadow: SHADOW.card, marginBottom: 20 }}>
              <HoursSavedChart data={weekly} />
            </div>
          </>
        )}

        {/* Top customers */}
        {topCustomers.length > 0 && (
          <>
            <SectionLabel>TOP CLIENTS</SectionLabel>
            <div style={{ marginTop: 10, marginBottom: 20 }}>
              <TopCustomers customers={topCustomers} />
            </div>
          </>
        )}

        {/* What customers ask */}
        {topics && (topics.topics?.length > 0 || topics.intents?.length > 0) && (
          <>
            <SectionLabel>WHAT CUSTOMERS ASK</SectionLabel>
            <div style={{ marginTop: 10 }}>
              <TopicsCard data={topics} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Mini bar chart for hours saved ──────────────────────────────
function HoursSavedChart({ data }) {
  const vals = data.map(d => d.ai_auto_sent * MINS_PER_CHAT);
  const max = Math.max(...vals, 1);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
      {data.map((d, i) => {
        const mins = d.ai_auto_sent * MINS_PER_CHAT;
        const pct = mins / max;
        const label = new Date(d.date).toLocaleDateString('en', { weekday: 'short' });
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ fontSize: 10, color: COLORS.textHint }}>
              {mins >= 60 ? `${(mins/60).toFixed(1)}h` : mins > 0 ? `${mins}m` : ''}
            </div>
            <div style={{
              width: '100%', borderRadius: 4,
              background: mins > 0
                ? `linear-gradient(180deg, #7C3AED, #6D28D9)`
                : COLORS.border,
              height: Math.max(pct * 60, mins > 0 ? 6 : 2),
              transition: 'height 0.3s ease',
            }} />
            <div style={{ fontSize: 10, color: COLORS.textHint }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Components ───────────────────────────────────────────────────
function HeroCard({ icon, value, label, sub, gradient, tagline }) {
  return (
    <div style={{
      flex: 1, borderRadius: RADII.lg, padding: '18px 16px',
      background: gradient, boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
      color: '#FFFFFF',
    }}>
      <div style={{ fontSize: 28, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, opacity: 0.9 }}>{label}</div>
      {tagline && (
        <div style={{
          fontSize: 11, marginTop: 5, opacity: 0.85,
          fontFamily: "'Fraunces', Georgia, serif",
          fontStyle: 'italic', fontWeight: 400,
          lineHeight: 1.3, letterSpacing: '-0.01em',
        }}>{tagline}</div>
      )}
      <div style={{ fontSize: 11, marginTop: tagline ? 4 : 3, opacity: 0.6 }}>{sub}</div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg, padding: '14px', boxShadow: SHADOW.card,
    }}>
      <div style={{ fontSize: 20, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: COLORS.textHint, marginBottom: 4 }}>{label}</div>
      <div style={{
        fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 400,
        color: accent, letterSpacing: '-0.025em', lineHeight: 1,
      }}>{value}</div>
      {sub && (
        <div style={{
          fontSize: 11, marginTop: 5,
          fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic',
          color: COLORS.textHint,
        }}>{sub}</div>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em' }}>{children}</div>;
}

// ─── What customers ask ───────────────────────────────────────────
function TopicsCard({ data }) {
  const { topics = [], intents = [], total = 0 } = data;
  const maxCount = topics[0]?.count || 1;

  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg, padding: '16px', boxShadow: SHADOW.card,
    }}>
      {total > 0 && (
        <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 14, fontFamily: 'monospace' }}>
          {total} inbound messages · last 30 days
        </div>
      )}

      {/* Topics as bars */}
      {topics.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: intents.length ? 16 : 0 }}>
          {topics.map(({ label, count }) => {
            const pct = Math.round((count / maxCount) * 100);
            return (
              <div key={label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: COLORS.textPrimary, textTransform: 'capitalize' }}>{label}</span>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: COLORS.textHint }}>{count}×</span>
                </div>
                <div style={{ height: 5, background: COLORS.border, borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    background: COLORS.teal,
                    width: `${pct}%`,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Intent chips */}
      {intents.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 8 }}>COMMON INTENTS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {intents.map(({ label, count }) => (
              <span key={label} style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 999,
                background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                color: COLORS.textSecondary,
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                {label}
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: COLORS.textHint }}>{count}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div style={{ padding: '20px', background: COLORS.bg, minHeight: '100vh' }}>
      <div style={{ height: 30, background: '#EBEBEB', borderRadius: 6, width: 140, marginBottom: 8, animation: 'pulse 1.5s infinite' }} />
      <div style={{ height: 16, background: '#F3F3F1', borderRadius: 4, width: 100, marginBottom: 20, animation: 'pulse 1.5s infinite' }} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 130, background: '#E0E0E0', borderRadius: RADII.lg, animation: 'pulse 1.5s infinite' }} />
        <div style={{ flex: 1, height: 130, background: '#E8E8E8', borderRadius: RADII.lg, animation: 'pulse 1.5s infinite' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ height: 100, background: '#F3F3F1', borderRadius: RADII.lg, animation: 'pulse 1.5s infinite', opacity: 1 - i * 0.1 }} />
        ))}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}
