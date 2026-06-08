'use client';
/**
 * Customers list — redesigned with warm-white design tokens.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import CustomerCard from '../customers/CustomerCard';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

function Skeleton() {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, overflow: 'hidden' }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
          borderTop: i > 0 ? `1px solid ${COLORS.border}` : 'none',
          animation: 'pulse 1.5s infinite', opacity: 1 - i * 0.15,
        }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: COLORS.border, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 14, width: '45%', background: COLORS.border, borderRadius: 6, marginBottom: 8 }} />
            <div style={{ height: 12, width: '60%', background: COLORS.border, borderRadius: 6 }} />
          </div>
        </div>
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}

const TIER_ACCENT = { gold: '#B08A4A', silver: '#708090', bronze: '#B87333', vip: '#7C3AED', regular: COLORS.green, new: COLORS.amber };

export default function CustomersPage() {
  const { business } = useTelegram();
  const supabase = createClient();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!business?.id) return;
    setLoading(true);
    supabase
      .from('customers')
      .select('*')
      .eq('business_id', business.id)
      .order('last_active_at', { ascending: false })
      .then(({ data }) => {
        setCustomers(data || []);
        setLoading(false);
      });
  }, [business?.id]);

  const counts = {
    vip:     customers.filter(c => c.tier === 'vip').length,
    regular: customers.filter(c => c.tier === 'regular').length,
    new:     customers.filter(c => c.tier === 'new' || !c.tier).length,
  };

  const tierFiltered = filter === 'all' ? customers : customers.filter(c => {
    if (filter === 'new') return c.tier === 'new' || !c.tier;
    return c.tier === filter;
  });

  const q = search.trim().toLowerCase();
  const shown = q
    ? tierFiltered.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.telegram_username || '').toLowerCase().includes(q) ||
        (c.tags || []).some(t => t.toLowerCase().includes(q))
      )
    : tierFiltered;

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 2 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>Clients</h1>
          {customers.length > 0 && (
            <button
              onClick={() => {
                const rows = [
                  ['Name', 'Phone', 'Telegram', 'Tier', 'Loyalty Points', 'Total Orders', 'Total Spent', 'Last Active'],
                  ...customers.map(c => [
                    c.name || '',
                    c.phone || '',
                    c.telegram_username ? '@' + c.telegram_username : '',
                    c.tier || '',
                    c.loyalty_points || 0,
                    c.total_orders || 0,
                    c.total_spent || 0,
                    c.last_active_at ? new Date(c.last_active_at).toLocaleDateString('en-GB') : '',
                  ])
                ];
                const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url;
                a.download = `customers-${new Date().toISOString().slice(0,10)}.csv`;
                a.click(); URL.revokeObjectURL(url);
              }}
              style={{
                appearance: 'none', border: `1px solid ${COLORS.border}`,
                background: COLORS.surface, borderRadius: RADII.md,
                padding: '6px 12px', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: FONT.body, color: COLORS.textSecondary,
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              ↓ Export CSV
            </button>
          )}
        </div>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '2px 0 12px' }}>
          {loading ? 'Loading…' : `${customers.length} total clients`}
        </p>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, pointerEvents: 'none', color: COLORS.textHint }}>🔍</span>
          <input
            type="search"
            placeholder="Search by name, username or tag…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: 36, paddingRight: 12, paddingTop: 9, paddingBottom: 9,
              fontSize: 14, color: COLORS.textPrimary, fontFamily: FONT.body,
              background: COLORS.bg, border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.lg, outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = COLORS.teal}
            onBlur={e => e.target.style.borderColor = COLORS.border}
          />
        </div>
      </div>

      <div style={{ padding: '16px 20px' }}>

        {/* Tier summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { key: 'vip',     label: 'VIP',     count: counts.vip },
            { key: 'regular', label: 'Regular', count: counts.regular },
            { key: 'new',     label: 'New',     count: counts.new },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? 'all' : key)}
              style={{
                appearance: 'none', cursor: 'pointer',
                background: filter === key ? TIER_ACCENT[key] + '15' : COLORS.surface,
                border: `1px solid ${filter === key ? TIER_ACCENT[key] : COLORS.border}`,
                borderRadius: RADII.lg, padding: '14px 10px', boxShadow: SHADOW.card,
                textAlign: 'center', fontFamily: FONT.body,
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{
                fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400,
                fontSize: 30, color: TIER_ACCENT[key], lineHeight: 1, letterSpacing: '-0.03em',
              }}>
                {loading ? '—' : count}
              </div>
              <div style={{ fontSize: 10, color: COLORS.textHint, marginTop: 5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <Skeleton />
        ) : shown.length === 0 ? (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '48px 24px', textAlign: 'center', boxShadow: SHADOW.card }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary }}>No clients yet</div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6, lineHeight: 1.5 }}>
              {q
                ? `No clients match "${search}".`
                : filter === 'all'
                  ? 'As people message your bot, their profiles will appear here.'
                  : `No ${filter} tier clients found.`}
            </div>
          </div>
        ) : (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, overflow: 'hidden', boxShadow: SHADOW.card }}>
            {shown.map((c, idx) => <CustomerCard key={c.id} customer={c} isLast={idx === shown.length - 1} />)}
          </div>
        )}
      </div>
    </div>
  );
}
