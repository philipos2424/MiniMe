'use client';
/**
 * CustomerCard — redesigned with design tokens.
 */
import Link from 'next/link';
import { timeAgo } from '../../lib/utils';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

const TIER_ACCENT = { gold: '#B08A4A', silver: '#708090', bronze: '#B87333', vip: '#7C3AED', regular: '#059669', new: '#D97706' };
const TIER_BG     = { gold: '#FEF9EE', silver: '#F5F7F8', bronze: '#FDF4ED', vip: '#F3F0FF', regular: '#F0FDF4', new: '#FFFBEB' };

export default function CustomerCard({ customer, isLast }) {
  const name = customer.name || 'Unknown';
  const tier = customer.tier || 'new';
  const accent = TIER_ACCENT[tier] || COLORS.textHint;
  const tierBg = TIER_BG[tier] || '#F3F4F6';
  const spent  = Number(customer.total_spent || 0);
  const orders = customer.total_orders || 0;

  return (
    <Link href={`/customers/${customer.id}`} style={{ textDecoration: 'none' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '13px 16px',
        borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}`,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = COLORS.border + '28'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Avatar */}
        <div style={{
          width: 42, height: 42, borderRadius: '50%',
          background: COLORS.teal + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: COLORS.teal,
          fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400, fontSize: 18,
          flexShrink: 0,
        }}>
          {name[0].toUpperCase()}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic',
              fontSize: 15, fontWeight: 400, color: COLORS.textPrimary,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {name}
            </span>
            <span style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 999, fontWeight: 600,
              background: tierBg, color: accent, flexShrink: 0,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {tier}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 3 }}>
            <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{orders} order{orders !== 1 ? 's' : ''}</span>
            {spent > 0 && <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{spent.toLocaleString()} ETB</span>}
            {customer.tags?.slice(0, 2).map(t => (
              <span key={t} style={{ fontSize: 11, padding: '1px 6px', background: COLORS.border, borderRadius: 4, color: COLORS.textHint }}>{t}</span>
            ))}
          </div>
        </div>

        {/* Right side: last active + loyalty points */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: COLORS.textHint, fontFamily: 'monospace' }}>
            {timeAgo(customer.last_active_at)}
          </div>
          {(customer.loyalty_points || 0) > 0 && (
            <div style={{ fontSize: 10, color: accent, fontWeight: 600, marginTop: 2 }}>
              {customer.loyalty_points} pts
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
