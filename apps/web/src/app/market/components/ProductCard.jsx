'use client';
import { fmtPrice } from '../lib';

/**
 * Product card for the grid and horizontal rows.
 * Trust signals: verified check + gold star rating when the shop has reviews.
 * Heart overlay appears only when engagement is possible (inside Telegram).
 */
export default function ProductCard({ p, onOpen, isFav, onFav, showAm = false }) {
  return (
    <div className="mk-card" onClick={() => onOpen(p)}>
      {onFav && (
        <button
          className="mk-heart"
          aria-label={isFav ? 'Remove from saved' : 'Save'}
          onClick={e => { e.stopPropagation(); onFav(p); }}
        >{isFav ? '❤️' : '🤍'}</button>
      )}
      {p.image_url
        ? <img className="mk-img" src={p.image_url} alt={p.name} loading="lazy" />
        : <div className="mk-img-fallback">{(p.name || '?').charAt(0).toUpperCase()}</div>}
      <div className="mk-card-body">
        <div className="mk-pname">{p.name}</div>
        {showAm && p.name_am && <div className="mk-pname-am">{p.name_am}</div>}
        <div className="mk-price">{fmtPrice(p.price, p.currency)}</div>
        <div className="mk-biz">{p.business_name}{p.verified && <span className="mk-verified"> ✅</span>}</div>
        {p.total_reviews > 0 && (
          <div className="mk-rating">⭐ {p.average_rating} ({p.total_reviews})</div>
        )}
        {p.reason && <div className="mk-reason">{p.reason}</div>}
      </div>
    </div>
  );
}
