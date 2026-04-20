'use client';

export default function Skeleton({ className = '', width, height, rounded = 'md' }) {
  const style = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;
  return (
    <div
      style={style}
      className={`animate-pulse bg-border/40 rounded-${rounded} ${className}`}
    />
  );
}

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-card border border-border rounded-xl p-4 space-y-3 ${className}`}>
      <Skeleton height={12} width="40%" />
      <Skeleton height={20} width="70%" />
      <Skeleton height={10} width="30%" />
    </div>
  );
}

export function SkeletonList({ rows = 4 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <Skeleton className="w-10 h-10 shrink-0" rounded="full" />
          <div className="flex-1 space-y-2">
            <Skeleton height={12} width="50%" />
            <Skeleton height={10} width="80%" />
          </div>
          <Skeleton height={10} width={40} />
        </div>
      ))}
    </div>
  );
}

const COLS_CLS = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
};

export function SkeletonGrid({ cols = 4, rows = 1 }) {
  const total = cols * rows;
  const colsCls = COLS_CLS[cols] || COLS_CLS[4];
  return (
    <div className={`grid ${colsCls} gap-4`}>
      {Array.from({ length: total }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
