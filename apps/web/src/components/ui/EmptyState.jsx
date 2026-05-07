'use client';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '64px 24px', fontFamily: FONT.body }}>
      {Icon && (
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 16,
        }}>
          <Icon size={24} color={COLORS.textHint} />
        </div>
      )}
      {title && (
        <h3 style={{ fontSize: 17, fontWeight: 700, color: COLORS.textPrimary, margin: '0 0 6px' }}>{title}</h3>
      )}
      {description && (
        <p style={{ fontSize: 14, color: COLORS.textSecondary, maxWidth: 320, margin: 0, lineHeight: 1.5 }}>{description}</p>
      )}
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}
