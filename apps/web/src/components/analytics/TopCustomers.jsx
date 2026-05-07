'use client';
import { formatPrice } from '../../lib/utils';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

const TIER_COLORS = { vip: '#7C3AED', regular: '#059669', new: '#D97706' };

export default function TopCustomers({ customers }) {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, overflow: 'hidden', boxShadow: SHADOW.card, fontFamily: FONT.body }}>
      {customers.map((c, i) => (
        <div key={c.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          borderBottom: i < customers.length - 1 ? `1px solid ${COLORS.border}` : 'none',
        }}>
          {/* Rank */}
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.textHint, width: 20, flexShrink: 0 }}>
            {String(i + 1).padStart(2, '0')}
          </span>

          {/* Avatar */}
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: `${COLORS.teal}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: COLORS.teal,
            fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400, fontSize: 15,
            flexShrink: 0,
          }}>
            {(c.name || '?')[0].toUpperCase()}
          </div>

          {/* Name + tier */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic',
              fontSize: 14, color: COLORS.textPrimary,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{c.name || 'Unknown'}</div>
            <div style={{ fontSize: 10, color: TIER_COLORS[c.tier] || COLORS.textHint, marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{c.tier}</div>
          </div>

          {/* Spent */}
          <div style={{
            fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 400,
            color: COLORS.teal, flexShrink: 0,
          }}>{formatPrice(c.total_spent)}</div>
        </div>
      ))}
      {!customers.length && (
        <p style={{ fontSize: 13, color: COLORS.textHint, textAlign: 'center', padding: '24px 0', margin: 0 }}>No customers yet</p>
      )}
    </div>
  );
}
