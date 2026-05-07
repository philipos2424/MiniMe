'use client';
import { COLORS, FONT } from '../../lib/design-tokens';

export default function TopBar() {
  return (
    <header style={{ height: 56, borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0, fontFamily: FONT.body }}>
      <div style={{ flex: 1 }} />
      <span className="animate-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.green }} title="MiniMe active" />
      <span style={{ color: COLORS.textHint, fontSize: 12 }}>MiniMe active</span>
    </header>
  );
}
