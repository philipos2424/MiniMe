'use client';
import { ArrowUp, ArrowDown } from 'lucide-react';

export default function MetricCard({ label, value, sub, delta }) {
  const hasDelta = typeof delta === 'number' && !Number.isNaN(delta);
  const up = hasDelta && delta >= 0;
  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-gold/40 transition">
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
