'use client';
import { MUTED, GOLD } from '../lib';

/** Shop list item — used by "Shops that can help", For-you shops, Saved tab.
 *  Tapping the row opens the in-Market shop view; the button opens the chat. */
export default function ShopRow({ s, onChat, onOpenShop }) {
  return (
    <div className="mk-shop" onClick={onOpenShop ? () => onOpenShop(s.id) : undefined}
      style={onOpenShop ? { cursor: 'pointer' } : undefined}>
      {s.logo_url ? <img className="mk-shop-logo" src={s.logo_url} alt="" /> : <div className="mk-shop-logo">{(s.name || '?').charAt(0)}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}{s.verified && <span className="mk-verified"> ✅</span>}</div>
        {s.reason && <div className="mk-reason">{s.reason}</div>}
        {!s.reason && s.tagline && <div style={{ fontSize: 12, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.tagline}</div>}
        {s.total_reviews > 0 && <div style={{ fontSize: 11.5, color: GOLD, marginTop: 2 }}>⭐ {s.average_rating}/5 ({s.total_reviews})</div>}
      </div>
      <button className="mk-chat-btn" onClick={e => { e.stopPropagation(); onChat(s); }}>💬 Chat</button>
    </div>
  );
}
