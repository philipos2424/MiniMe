'use client';
import { COLORS, RADII, SHADOW } from '../../lib/design-tokens';

export default function Card({ children, hover = false, as: Tag = 'div', style: extraStyle, ...rest }) {
  return (
    <Tag
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: RADII.lg,
        padding: 16,
        boxShadow: SHADOW.card,
        transition: hover ? 'border-color 0.15s' : undefined,
        ...extraStyle,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
