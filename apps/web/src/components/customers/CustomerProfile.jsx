'use client';
import { timeAgo, formatPrice } from '../../lib/utils';

const TIER_COLORS = { vip: '#7C3AED', regular: '#059669', new: '#D97706' };

export default function CustomerProfile({ customer, messages }) {
  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center text-gold text-2xl font-bold">
          {(customer.name || '?')[0].toUpperCase()}
        </div>
        <div>
          <h1 className="font-display text-2xl text-gold-light">{customer.name || 'Unknown'}</h1>
          <span className="text-sm px-2 py-0.5 rounded uppercase" style={{ background: (TIER_COLORS[customer.tier] || '#6B7280') + '33', color: TIER_COLORS[customer.tier] || '#6B7280' }}>
            {customer.tier}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[['Total Orders', customer.total_orders], ['Total Spent', formatPrice(customer.total_spent)], ['First Contact', timeAgo(customer.first_contact_at)], ['Last Active', timeAgo(customer.last_active_at)]].map(([label, val]) => (
          <div key={label} className="bg-card border border-border rounded-xl p-3">
            <p className="text-muted text-xs">{label}</p>
            <p className="text-gold-light font-semibold mt-1">{val}</p>
          </div>
        ))}
      </div>

      {customer.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2">{customer.tags.map(t => <span key={t} className="bg-bg border border-border text-muted text-xs px-2 py-1 rounded-full">{t}</span>)}</div>
      )}

      {customer.ai_notes && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-gold text-xs font-medium mb-1">🧠 AI Notes</p>
          <p className="text-body text-sm">{customer.ai_notes}</p>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-gold font-semibold text-sm mb-3">Recent Messages</h2>
        <div className="space-y-2">
          {messages.map(m => (
            <div key={m.id} className={`text-sm p-2 rounded-lg ${m.direction === 'inbound' ? 'bg-bg text-body' : 'bg-gold/10 text-gold-light'}`}>
              {m.content}
            </div>
          ))}
          {!messages.length && <p className="text-muted text-sm">No messages yet</p>}
        </div>
      </div>
    </div>
  );
}
