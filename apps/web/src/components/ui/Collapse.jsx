'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

// Progressive-disclosure row. Closed by default so advanced controls don't
// compete with everyday tasks. Header is a single tap target; the chevron
// rotates to signal open/closed state.
export default function Collapse({
  label,
  sub,
  icon,
  defaultOpen = false,
  children,
  style: extraStyle,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg,
      overflow: 'hidden',
      fontFamily: FONT.body,
      ...extraStyle,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          width: '100%', padding: '14px 16px',
          background: 'transparent', border: 'none',
          textAlign: 'left', cursor: 'pointer',
          fontFamily: FONT.body, color: COLORS.textPrimary,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {icon && <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary }}>{label}</div>
          {sub && <div style={{ fontSize: 12.5, color: COLORS.textHint, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
        </div>
        <ChevronDown
          size={18}
          color={COLORS.textHint}
          strokeWidth={1.8}
          style={{ flexShrink: 0, transition: 'transform .18s', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${COLORS.divider}`, padding: 16 }}>
          {children}
        </div>
      )}
    </div>
  );
}
