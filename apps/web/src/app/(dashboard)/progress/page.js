'use client';
/**
 * Progress — "What is happening in my business?"
 *
 * Shows orders by status, revenue today, and top selling products.
 * Data: /api/pipeline (order counts) + /api/analytics (revenue + top products).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../context/TelegramContext';

// ─── Tokens ───────────────────────────────────────────────────────────────────
const INK   = 'var(--ink)';
const PAPER = 'var(--paper)';
const CARD  = 'var(--card)';
const CREAM2= 'var(--cream-2)';
const GOLD  = 'var(--gold)';
const MINT  = 'var(--mint)';
const LINE  = 'var(--line)';
const LINE2 = 'var(--line-soft)';
const MUTED = 'var(--muted)';
const ERROR = 'var(--error)';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

// ─── Order status config ───────────────────────────────────────────────────────
const ORDER_STATUSES = [
  { key: 'paid',        label: 'Paid',             emoji: '🟢', color: '#4FA38A',  bg: 'rgba(79,163,138,.1)' },
  { key: 'new',         label: 'New Orders',        emoji: '🔵', color: '#3B82F6',  bg: 'rgba(59,130,246,.1)' },
  { key: 'in_progress', label: 'In Progress',       emoji: '🟡', color: '#D9A441',  bg: 'rgba(217,164,65,.1)' },
  { key: 'awaiting',    label: 'Awaiting Payment',  emoji: '🟠', color: '#B08A4A',  bg: 'rgba(176,138,74,.1)' },
  { key: 'fulfilled',   label: 'Delivered',         emoji: '🚚', color: '#8A9590',  bg: 'rgba(138,149,144,.1)' },
];

function fmt(n, currency = 'ETB') {
  if (n == null || n === 0) return `0 ${currency}`;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M ${currency}`;
  if (n >= 1000)    return `${(n / 1000).toFixed(1)}k ${currency}`;
  return `${Number(n).toLocaleString()} ${currency}`;
}

// ─── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ title }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
      textTransform: 'uppercase', color: MUTED,
      marginBottom: 12, paddingLeft: 2,
    }}>
      {title}
    </div>
  );
}

// ─── Order status row ──────────────────────────────────────────────────────────
function StatusRow({ emoji, label, count, color, bg, last }) {
  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
        borderBottom: last ? 'none' : `1px solid ${LINE2}`,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: bg, display: 'grid', placeItems: 'center',
          fontSize: 20, flexShrink: 0,
        }}>
          {emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>{label}</div>
        </div>
        <div style={{
          fontFamily: SERIF, fontSize: 26, fontWeight: 400,
          color: count > 0 ? color : MUTED,
          letterSpacing: '-0.02em', lineHeight: 1,
        }}>
          {count}
        </div>
      </div>
    </>
  );
}

// ─── Skeleton row ──────────────────────────────────────────────────────────────
function SkeletonRow({ last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
      borderBottom: last ? 'none' : `1px solid ${LINE2}`,
    }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: CREAM2, flexShrink: 0, animation: 'pulse 1.5s infinite' }} />
      <div style={{ flex: 1 }}>
        <div style={{ height: 14, width: '50%', background: CREAM2, borderRadius: 6, animation: 'pulse 1.5s infinite' }} />
      </div>
      <div style={{ width: 28, height: 28, background: CREAM2, borderRadius: 8, animation: 'pulse 1.5s infinite' }} />
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function ProgressPage() {
  const { initData, business } = useTelegram() || {};

  const [pipeline, setPipeline]     = useState(null);
  const [analytics, setAnalytics]   = useState(null);
  const [loadingP, setLoadingP]     = useState(true);
  const [loadingA, setLoadingA]     = useState(true);

  const currency = business?.currency || 'ETB';

  useEffect(() => {
    if (!initData) return;

    // Fetch pipeline
    fetch('/api/pipeline', {
      headers: { 'x-telegram-init-data': initData },
      cache: 'no-store',
    })
      .then(r => r.json())
      .then(j => { setPipeline(j); setLoadingP(false); })
      .catch(() => setLoadingP(false));

    // Fetch analytics (7d for revenue + top products)
    fetch('/api/analytics?period=7d', {
      headers: { 'x-telegram-init-data': initData },
    })
      .then(r => r.json())
      .then(j => { setAnalytics(j); setLoadingA(false); })
      .catch(() => setLoadingA(false));
  }, [initData]);

  const todayDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const totalRevenue  = analytics?.total_revenue ?? analytics?.totalRevenue ?? 0;
  const prevRevenue   = analytics?.prev_revenue   ?? 0;
  const revChange     = prevRevenue > 0 ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100) : null;
  const topProducts   = analytics?.top_products   ?? analytics?.topProducts ?? [];

  const totalOrders = ORDER_STATUSES.reduce((acc, s) => acc + (pipeline?.[s.key]?.length || 0), 0);

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 100, fontFamily: BODY, color: INK }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

      {/* ── Header ── */}
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>
          Progress
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 28, color: INK, letterSpacing: '-0.015em', lineHeight: 1.1, marginBottom: 4 }}>
          {business?.name || 'Your Business'}
        </div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 24 }}>
          {todayDate}
        </div>
      </div>

      {/* ── Orders by status ── */}
      <div style={{ padding: '0 20px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionLabel title="Orders" />
          {!loadingP && totalOrders > 0 && (
            <div style={{ fontSize: 12, color: MUTED }}>{totalOrders} total</div>
          )}
        </div>
        <div style={{ background: CARD, border: `1px solid ${LINE2}`, borderRadius: 18, overflow: 'hidden' }}>
          {loadingP ? (
            ORDER_STATUSES.map((s, i) => <SkeletonRow key={s.key} last={i === ORDER_STATUSES.length - 1} />)
          ) : (
            ORDER_STATUSES.map((s, i) => (
              <StatusRow
                key={s.key}
                emoji={s.emoji}
                label={s.label}
                count={pipeline?.[s.key]?.length || 0}
                color={s.color}
                bg={s.bg}
                last={i === ORDER_STATUSES.length - 1}
              />
            ))
          )}
        </div>
        {!loadingP && (
          <Link href="/pipeline" style={{
            display: 'block', textAlign: 'center', marginTop: 10,
            fontSize: 13, color: MUTED, textDecoration: 'none',
          }}>
            View full pipeline →
          </Link>
        )}
      </div>

      {/* ── Revenue (7 days) ── */}
      <div style={{ padding: '0 20px', marginBottom: 24 }}>
        <SectionLabel title="Revenue — Last 7 Days" />
        <div style={{ background: CARD, border: `1px solid ${LINE2}`, borderRadius: 18, padding: '20px 20px' }}>
          {loadingA ? (
            <div style={{ height: 40, background: CREAM2, borderRadius: 8, animation: 'pulse 1.5s infinite' }} />
          ) : (
            <>
              <div style={{ fontFamily: SERIF, fontSize: 36, color: INK, letterSpacing: '-0.025em', lineHeight: 1 }}>
                {fmt(totalRevenue, currency)}
              </div>
              {revChange !== null && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8,
                  fontSize: 13, fontWeight: 600,
                  color: revChange >= 0 ? '#4FA38A' : ERROR,
                }}>
                  {revChange >= 0 ? '↑' : '↓'} {Math.abs(revChange)}% vs previous period
                </div>
              )}
              <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                From paid & fulfilled orders
              </div>
            </>
          )}
        </div>
        <Link href="/analytics" style={{
          display: 'block', textAlign: 'center', marginTop: 10,
          fontSize: 13, color: MUTED, textDecoration: 'none',
        }}>
          View full analytics →
        </Link>
      </div>

      {/* ── Top products ── */}
      {(loadingA || topProducts.length > 0) && (
        <div style={{ padding: '0 20px', marginBottom: 24 }}>
          <SectionLabel title="Top Products — Last 7 Days" />
          <div style={{ background: CARD, border: `1px solid ${LINE2}`, borderRadius: 18, overflow: 'hidden' }}>
            {loadingA ? (
              [0, 1, 2].map(i => <SkeletonRow key={i} last={i === 2} />)
            ) : (
              topProducts.slice(0, 5).map((p, i) => (
                <div key={p.name} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 16px',
                  borderBottom: i < Math.min(topProducts.length, 5) - 1 ? `1px solid ${LINE2}` : 'none',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: CREAM2,
                    display: 'grid', placeItems: 'center',
                    fontFamily: SERIF, fontSize: 15, color: MUTED,
                    flexShrink: 0, fontWeight: 600,
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>
                      {p.orders} order{p.orders !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div style={{ fontFamily: SERIF, fontSize: 15, color: INK, flexShrink: 0 }}>
                    {fmt(p.revenue, currency)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Empty state — no data ── */}
      {!loadingP && !loadingA && totalOrders === 0 && topProducts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
          <div style={{ fontFamily: SERIF, fontSize: 22, color: INK, marginBottom: 8 }}>No data yet</div>
          <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.6, maxWidth: 260, margin: '0 auto' }}>
            Your orders and sales will appear here once customers start buying.
          </div>
        </div>
      )}
    </div>
  );
}
