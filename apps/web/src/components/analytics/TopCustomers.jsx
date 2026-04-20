'use client';
import { formatPrice } from '../../lib/utils';

const TIER_COLORS = { vip: '#7C3AED', regular: '#059669', new: '#D97706' };

export default function TopCustomers({ customers }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-gold font-semibold text-sm mb-3">Top Customers</h2>
      <div className="space-y-2">
        {customers.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3">
            <span className="text-muted text-sm w-4">{i + 1}</span>
            <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center text-gold text-sm font-bold shrink-0">
              {(c.name || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-body text-sm">{c.name || 'Unknown'}</p>
              <span className="text-xs" style={{ color: TIER_COLORS[c.tier] }}>{c.tier}</span>
            </div>
            <p className="text-gold font-medium text-sm">{formatPrice(c.total_spent)}</p>
          </div>
        ))}
        {!customers.length && <p className="text-muted text-sm text-center py-4">No customers yet</p>}
      </div>
    </div>
  );
}
