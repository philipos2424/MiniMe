'use client';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

const VARIANT_STYLES = {
  primary:   { background: COLORS.teal, color: '#FFFFFF', border: 'none' },
  secondary: { background: COLORS.surface, color: COLORS.textPrimary, border: `1px solid ${COLORS.border}` },
  ghost:     { background: 'transparent', color: COLORS.textSecondary, border: 'none' },
  danger:    { background: COLORS.red, color: '#FFFFFF', border: 'none' },
};

const SIZE_STYLES = {
  sm: { padding: '6px 12px', fontSize: 12, minHeight: 36 },
  md: { padding: '10px 16px', fontSize: 14, minHeight: 44 },
  lg: { padding: '12px 20px', fontSize: 15, minHeight: 48 },
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled,
  style: extraStyle,
  as: Tag = 'button',
  ...rest
}) {
  const vs = VARIANT_STYLES[variant] || VARIANT_STYLES.primary;
  const ss = SIZE_STYLES[size] || SIZE_STYLES.md;

  return (
    <Tag
      type={Tag === 'button' ? type : undefined}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        borderRadius: RADII.md, fontWeight: 600, fontFamily: FONT.body,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s, opacity 0.15s',
        textDecoration: 'none',
        ...vs, ...ss, ...extraStyle,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
