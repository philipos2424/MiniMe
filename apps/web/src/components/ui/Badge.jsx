'use client';
import { COLORS, RADII } from '../../lib/design-tokens';

const VARIANTS = {
  default: { background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary },
  gold:    { background: `${COLORS.teal}15`, border: `1px solid ${COLORS.teal}30`, color: COLORS.teal },
  agent:   { background: '#6366F115', border: '1px solid #6366F130', color: '#6366F1' },
  success: { background: `${COLORS.green}18`, border: `1px solid ${COLORS.green}30`, color: COLORS.green },
  warn:    { background: `${COLORS.amber}18`, border: `1px solid ${COLORS.amber}30`, color: COLORS.amber },
  danger:  { background: `${COLORS.red}18`, border: `1px solid ${COLORS.red}30`, color: COLORS.red },
};

export default function Badge({ children, variant = 'default' }) {
  const s = VARIANTS[variant] || VARIANTS.default;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999,
      fontSize: 12, fontWeight: 500,
      ...s,
    }}>
      {children}
    </span>
  );
}
