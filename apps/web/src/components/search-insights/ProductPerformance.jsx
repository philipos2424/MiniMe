'use client';
/**
 * ProductPerformance — how the owner's products perform on the Market:
 * views, "Order on Telegram" taps, and click rate per product.
 */
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

export default function ProductPerformance({ products }) {
  if (!products) return null;

  if (!products.length) {
    return (
      <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5 }}>
        No product views yet. Add products in{' '}
        <a href="/settings/catalog" style={{ color: COLORS.teal, textDecoration: 'none', fontWeight: 600 }}>Catalog</a>{' '}
        — they'll appear on the MiniMe Market and in search results, and you'll see views and order taps here.
      </div>
    );
  }

  const maxViews = Math.max(...products.map(p => p.views), 1);

  return (
    <div style={{ fontFamily: FONT.body }}>
      <div style={{ display: 'flex', fontSize: 10, color: COLORS.textHint, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', paddingBottom: 8, borderBottom: `1px solid ${COLORS.border}` }}>
        <span style={{ flex: 1 }}>Product</span>
        <span style={{ width: 52, textAlign: 'right' }}>Views</span>
        <span style={{ width: 52, textAlign: 'right' }}>Taps</span>
        <span style={{ width: 52, textAlign: 'right' }}>Rate</span>
      </div>
      {products.slice(0, 10).map((p, i) => (
        <div key={p.id} style={{ padding: '9px 0', borderBottom: i < Math.min(products.length, 10) - 1 ? `1px solid ${COLORS.border}` : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {p.image_url ? (
              <img src={p.image_url} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', border: `1px solid ${COLORS.border}`, flexShrink: 0 }} />
            ) : (
              <div style={{ width: 34, height: 34, borderRadius: 8, background: COLORS.tealLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>📦</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.name}
              </div>
              {p.price != null && (
                <div style={{ fontSize: 11, color: COLORS.textHint }}>
                  {Number(p.price).toLocaleString()} {p.currency || 'ETB'}
                </div>
              )}
            </div>
            <span style={{ width: 52, textAlign: 'right', fontSize: 13, color: COLORS.textSecondary, fontFamily: 'monospace' }}>{p.views}</span>
            <span style={{ width: 52, textAlign: 'right', fontSize: 13, color: '#D97706', fontWeight: 600, fontFamily: 'monospace' }}>{p.clicks}</span>
            <span style={{ width: 52, textAlign: 'right', fontSize: 13, color: p.click_rate >= 20 ? COLORS.green : COLORS.textHint, fontWeight: 600 }}>{p.click_rate}%</span>
          </div>
          <div style={{ height: 4, background: COLORS.border, borderRadius: 2, overflow: 'hidden', marginTop: 6, marginLeft: 44 }}>
            <div style={{ width: `${Math.max(Math.round((p.views / maxViews) * 100), 2)}%`, height: '100%', background: COLORS.teal, borderRadius: 2 }} />
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 10, lineHeight: 1.4 }}>
        Views and "Order on Telegram" taps from the MiniMe Market. High-rate products convert lookers into buyers.
      </div>
    </div>
  );
}
