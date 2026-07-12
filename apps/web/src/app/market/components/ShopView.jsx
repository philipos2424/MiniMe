'use client';
/**
 * ShopView — full-screen overlay inside the Market: shop header (logo, name,
 * verified badge, rating), follow, chat, description, product grid, reviews.
 * Fetches /api/market/shop?business_id=... on open and logs view_shop.
 */
import { useEffect, useState } from 'react';
import { SERIF, MUTED, GOLD, fmtPrice, shareLink, openChat, logEvent } from '../lib';
import ProductGrid from './ProductGrid';
import ReviewsBlock from './ReviewsBlock';

export default function ShopView({ businessId, onClose, onOpenProduct, favIds, onFav, isFollowing, onFollow, canEngage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    setData(null);
    setError(false);
    logEvent('view_shop', { business_id: businessId });
    fetch(`/api/market/shop?business_id=${businessId}`, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, [businessId]);

  if (!businessId) return null;

  function chat() {
    if (data?.shop?.chat_url) { logEvent('click_chat', { business_id: businessId }); openChat(data.shop.chat_url); }
  }
  function share() {
    if (data?.shop) { logEvent('share', { business_id: businessId }); openChat(shareLink({ shop: data.shop })); }
  }

  return (
    <div className="mk-shopview" role="dialog" aria-modal="true">
      <div className="mk-shopview-head">
        <button className="mk-back" onClick={onClose} aria-label="Back">←</button>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{data?.shop?.name || 'Shop'}</div>
      </div>
      <div className="mk-shopview-body">
        {error ? (
          <div className="mk-empty"><div className="big">😔</div>This shop isn't available right now.</div>
        ) : !data ? (
          <div className="mk-grid">{Array.from({ length: 4 }, (_, i) => <div key={i} className="mk-skel" />)}</div>
        ) : (
          <>
            <div className="mk-shop-hero">
              {data.shop.logo_url
                ? <img className="mk-shop-logo" src={data.shop.logo_url} alt="" />
                : <div className="mk-shop-logo">{(data.shop.name || '?').charAt(0)}</div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mk-shop-name">{data.shop.name}{data.shop.verified && <span className="mk-verified"> ✅</span>}</div>
                {data.shop.total_reviews > 0 && (
                  <div style={{ fontSize: 13, color: GOLD, marginTop: 2 }}>⭐ {data.shop.average_rating}/5 ({data.shop.total_reviews})</div>
                )}
              </div>
            </div>
            {data.shop.tagline && <div style={{ fontSize: 13, color: MUTED, marginTop: 10 }}>{data.shop.tagline}</div>}
            {data.shop.description && <div style={{ fontSize: 14, lineHeight: 1.55, color: '#3a514c', marginTop: 8 }}>{data.shop.description}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="mk-chat-btn" style={{ flex: 1, padding: 12 }} onClick={chat}>💬 Chat</button>
              {canEngage && (
                <button className={`mk-follow${isFollowing ? ' on' : ''}`} onClick={() => onFollow(data.shop)}>
                  {isFollowing ? '✓ Following' : '+ Follow'}
                </button>
              )}
              {canEngage && (
                <button className="mk-action" style={{ flex: 'none', padding: '9px 14px' }} onClick={share}>📤</button>
              )}
            </div>

            {data.items?.length > 0 && (
              <>
                <div className="mk-label">🛍️ Products</div>
                <ProductGrid items={data.items} onOpen={onOpenProduct} favIds={favIds} onFav={canEngage ? onFav : undefined} />
              </>
            )}

            <ReviewsBlock
              businessId={businessId}
              canEngage={canEngage}
              onChat={chat}
              embeddedReviews={data.reviews}
              embeddedSummary={{ average_rating: data.shop.average_rating, total_reviews: data.shop.total_reviews }}
            />
          </>
        )}
      </div>
    </div>
  );
}
