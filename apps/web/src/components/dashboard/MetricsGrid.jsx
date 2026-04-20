'use client';
import { ArrowUp, ArrowDown } from 'lucide-react';

function MetricCard({ label, value, sub, delta }) {
  const hasDelta = typeof delta === 'number' && !Number.isNaN(delta);
  const up = hasDelta && delta >= 0;
  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-gold/40 transition group">
      <p className="text-muted text-xs mb-1 uppercase tracking-wide">{label}</p>
      <p className="font-display text-gold-light text-3xl leading-tight">{value}</p>
      <div className="flex items-center gap-2 mt-1">
        {hasDelta && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium ${
              up ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(delta)}%
          </span>
        )}
        {sub && <p className="text-muted text-xs">{sub}</p>}
      </div>
    </div>
  );
}

export default function MetricsGrid({ stats }) {
  const aiHandledPct = stats.inbound_messages > 0 ? Math.round((stats.ai_auto_sent / stats.inbound_messages) * 100) : 0;
  const editRate = stats.ai_auto_sent > 0 ? Math.round((stats.ai_edited / stats.ai_auto_sent) * 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard label="Messages Today" value={stats.total_messages} />
      <MetricCard label="AI Handled" value={`${aiHandledPct}%`} sub={`${stats.ai_auto_sent} auto-sent`} />
      <MetricCard label="Revenue" value={`${Number(stats.revenue || 0).toFixed(0)} ETB`} />
      <MetricCard label="Edit Rate" value={`${editRate}%`} sub="lower is better" />
    </div>
  );
}

export { MetricCard };
