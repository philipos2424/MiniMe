'use client';

const VARIANTS = {
  default: 'bg-bg border border-border text-muted',
  gold: 'bg-gold/10 border border-gold/20 text-gold',
  agent: 'bg-agent/10 border border-agent/30 text-agent',
  success: 'bg-emerald-900/20 border border-emerald-700/30 text-emerald-400',
  warn: 'bg-yellow-900/20 border border-yellow-700/30 text-yellow-400',
  danger: 'bg-red-900/20 border border-red-700/30 text-red-400',
};

export default function Badge({ children, variant = 'default', className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${VARIANTS[variant] || VARIANTS.default} ${className}`}>
      {children}
    </span>
  );
}
