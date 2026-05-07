'use client';
import { COLORS, RADII, SHADOW } from '../../lib/design-tokens';

export default function Skeleton({ width, height, rounded = 'md', style: extraStyle }) {
  const radii = { sm: RADII.sm, md: RADII.md, lg: RADII.lg, xl: RADII.xl, full: 9999 };
  return (
    <div
      className="animate-pulse"
      style={{
        background: COLORS.border,
        borderRadius: radii[rounded] ?? RADII.md,
        width: typeof width === 'number' ? `${width}px` : (width || '100%'),
        height: typeof height === 'number' ? `${height}px` : (height || 12),
        ...extraStyle,
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: SHADOW.card }}>
      <Skeleton height={12} width="40%" />
      <Skeleton height={20} width="70%" />
      <Skeleton height={10} width="30%" />
    </div>
  );
}

export function SkeletonList({ rows = 4 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Skeleton style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton height={12} width="50%" />
            <Skeleton height={10} width="80%" />
          </div>
          <Skeleton height={10} width={40} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonGrid({ cols = 4, rows = 1 }) {
  const total = cols * rows;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
      {Array.from({ length: total }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
