/**
 * Social-proof view counter ("256 viewed this shop"). Renders nothing below a
 * floor (default 10) so a new shop with a handful of views doesn't look empty.
 * Pure/presentational — server components pass a count fetched at render time.
 */
export default function ViewCount({ count, kind = 'shop', floor = 10, style }) {
  const n = Number(count) || 0;
  if (n < floor) return null;

  const label = kind === 'product'
    ? `${n.toLocaleString()} viewed this product`
    : `${n.toLocaleString()} viewed this shop`;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#8a9590', fontWeight: 500, ...style }}>
      <span aria-hidden>👁️</span>{label}
    </span>
  );
}
