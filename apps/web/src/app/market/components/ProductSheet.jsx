'use client';
import { useEffect, useState } from 'react';
import { INK, MUTED, fmtPrice, shareLink, openChat } from '../lib';
import ReviewsBlock from './ReviewsBlock';

/** Slide-up product detail sheet: order CTA, save/share actions, seller line
 *  (tap to open the full shop), and reviews. */
export default function ProductSheet({ sheet, onClose, onOrder, onOpenShop, isFav, onFav, canEngage, onShare }) {
  // "N viewed this product" social proof — only shown once it clears a floor so
  // a fresh listing doesn't read as "2 viewed". Fetched per open, lightly cached.
  const [views, setViews] = useState(null);
  useEffect(() => {
    if (!sheet?.id) { setViews(null); return; }
    let alive = true;
    setViews(null);
    fetch(`/api/market/product-views?id=${sheet.id}`)
      .then(r => r.json())
      .then(d => { if (alive) setViews(Number(d?.count) || 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, [sheet?.id]);

  if (!sheet) return null;
  return (
    <>
      <div className="mk-overlay" onClick={onClose} />
      <div className="mk-sheet" role="dialog" aria-modal="true">
        <div className="mk-sheet-grip" />
        {sheet.image_url && <img className="mk-sheet-img" src={sheet.image_url} alt={sheet.name} />}
        <div className="mk-sheet-body">
          <div className="mk-sheet-name">{sheet.name}</div>
          {sheet.name_am && <div style={{ fontSize: 14, color: MUTED, marginTop: 2 }}>{sheet.name_am}</div>}
          <div className="mk-sheet-price">{fmtPrice(sheet.price, sheet.currency)}</div>
          {views >= 10 && (
            <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 500, marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span aria-hidden>👁️</span>{views.toLocaleString()} viewed this product
            </div>
          )}
          {sheet.description && <div className="mk-sheet-desc">{sheet.description}</div>}
          <div className="mk-sheet-biz">
            <span>Sold by</span>
            {onOpenShop ? (
              <button className="open-shop" onClick={() => onOpenShop(sheet.business_id)}>{sheet.business_name}</button>
            ) : (
              <strong style={{ color: INK }}>{sheet.business_name}</strong>
            )}
            {sheet.verified && <span className="mk-verified">✅ Verified</span>}
          </div>

          {canEngage && (
            <div className="mk-sheet-actions">
              <button className={`mk-action${isFav ? ' on' : ''}`} onClick={() => onFav(sheet)}>
                {isFav ? '❤️ Saved' : '🤍 Save'}
              </button>
              <button className="mk-action" onClick={() => onShare(sheet)}>📤 Share</button>
            </div>
          )}

          {sheet.business_id && (
            <ReviewsBlock
              businessId={sheet.business_id}
              canEngage={canEngage}
              onChat={() => onOrder(sheet)}
            />
          )}
        </div>
        <button className="mk-order" onClick={() => onOrder(sheet)}>
          💬 Order on Telegram
        </button>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: MUTED, marginTop: 8 }}>
          Opens a chat with the shop — ask anything, pay there.
        </div>
      </div>
    </>
  );
}

export function shareProduct(p) {
  openChat(shareLink({ product: p }));
}
