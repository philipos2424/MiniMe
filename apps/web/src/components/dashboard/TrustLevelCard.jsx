'use client';
import Link from 'next/link';

const LEVELS = {
  0: { emoji: '👁️', name: 'Shadow', color: '#6B7280' },
  1: { emoji: '✋', name: 'Supervised', color: '#D97706' },
  2: { emoji: '🤝', name: 'Trusted', color: '#059669' },
  3: { emoji: '🚀', name: 'Full Agent', color: '#7C3AED' },
};

export default function TrustLevelCard({ business }) {
  const lvl = LEVELS[business.trust_level] || LEVELS[0];
  return (
    <Link href="/settings/trust" className="flex items-center gap-3 bg-card border border-border rounded-xl p-4 min-h-[44px] hover:border-gold/40 transition">
      <span className="text-2xl">{lvl.emoji}</span>
      <div>
        <p className="text-muted text-xs">Trust Level</p>
        <p className="font-semibold" style={{ color: lvl.color }}>{lvl.name}</p>
      </div>
      {business.panic_mode && (
        <span className="ml-auto text-xs bg-red-900/30 text-red-400 border border-red-700/30 px-2 py-0.5 rounded-full">🔴 Panic Mode</span>
      )}
    </Link>
  );
}
