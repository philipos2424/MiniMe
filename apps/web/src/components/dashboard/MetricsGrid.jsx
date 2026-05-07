'use client';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

function MetricCard({ label, value, sub, delta }) {
  const hasDelta = typeof delta === 'number' && !Number.isNaN(delta);
  const up = hasDelta && delta >= 0;
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, fontFamily: FONT.body }}>
      <p style={{ fontSize: 11, color: COLORS.textHint, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 800, color: COLORS.textPrimary, margin: 0, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        {hasDelta && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 600, color: up ? COLORS.green : COLORS.red }}>
            {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(delta)}%
          </span>
        )}
        {sub && <p style={{ fontSize: 12, color: COLORS.textHint, margin: 0 }}>{sub}</p>}
      </div>
    </div>
  );
}

export default function MetricsGrid({ stats }) {
  const aiHandledPct = stats.inbound_messages > 0 ? Math.round((stats.ai_auto_sent / stats.inbound_messages) * 100) : 0;
  const editRate = stats.ai_auto_sent > 0 ? Math.round((stats.ai_edited / stats.ai_auto_sent) * 100) : 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
      <MetricCard label="Messages Today" value={stats.total_messages} />
      <MetricCard label="AI Handled" value={`${aiHandledPct}%`} sub={`${stats.ai_auto_sent} auto-sent`} />
      <MetricCard label="Revenue" value={`${Number(stats.revenue || 0).toFixed(0)} ETB`} />
      <MetricCard label="Edit Rate" value={`${editRate}%`} sub="lower is better" />
    </div>
  );
}

export { MetricCard };
