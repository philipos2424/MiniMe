'use client';
import Link from 'next/link';
import { timeAgo } from '../../lib/utils';

const TIER_COLORS = { vip: '#7C3AED', regular: '#059669', new: '#D97706' };

export default function CustomerCard({ customer }) {
  return (
    <Link href={`/customers/${customer.id}`} className="flex items-center gap-3 bg-card border border-border rounded-xl p-4 hover:border-gold transition">
      <div className="w-10 h-10 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center text-gold font-semibold shrink-0">
        {(customer.name || '?')[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-gold-light font-medium truncate">{customer.name || 'Unknown'}</p>
          <span className="text-xs px-1.5 py-0.5 rounded uppercase shrink-0" style={{ background: (TIER_COLORS[customer.tier] || '#6B7280') + '33', color: TIER_COLORS[customer.tier] || '#6B7280' }}>
            {customer.tier}
          </span>
        </div>
        <div className="flex gap-3 text-xs text-muted mt-0.5">
          <span>{customer.total_orders} orders</span>
          <span>{Number(customer.total_spent || 0).toFixed(0)} ETB</span>
          {customer.tags?.slice(0, 2).map(t => <span key={t} className="bg-bg px-1.5 rounded">{t}</span>)}
        </div>
      </div>
      <p className="text-muted text-xs shrink-0">{timeAgo(customer.last_active_at)}</p>
    </Link>
  );
}
