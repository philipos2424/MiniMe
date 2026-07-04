'use client';
/**
 * /market — MiniMe Market: customer-facing marketplace Mini App.
 *
 * Public (no merchant auth — customers aren't merchants, so this page reads
 * window.Telegram directly instead of the dashboard's TelegramProvider).
 * Browse every discoverable business's products; type what you need and get
 * products AND shops to chat with; personalized "For you" row from the
 * user's own activity. Ordering hands off to the business's Telegram bot.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const INK = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const LINE = '#E4DED1';
const MUTED = '#8A9590';
const TEAL = '#4FA38A';
const GOLD = '#B08A4A';
const SERIF = "'Newsreader', 'Fraunces', Georgia, serif";
const BODY = "'Geist', 'Noto Sans Ethiopic', -apple-system, system-ui, sans-serif";

const CATEGORIES = [
  ['', 'All'],
  ['electronics_phones', '📱 Electronics'],
  ['food_beverage', '☕ Food & Cafés'],
  ['catering_food', '🍽️ Catering'],
  ['clothing_fashion', '👗 Fashion'],
  ['beauty_wellness', '💆 Beauty'],
  ['branding_design', '🎨 Design'],
  ['printing_signage', '🖨️ Printing'],
  ['photography_video', '📸 Photo'],
  ['events_entertainment', '🎉 Events'],
  ['construction_interior', '🏗️ Construction'],
  ['it_tech', '💻 Tech'],
  ['transport_delivery', '🚚 Delivery'],
  ['training_consulting', '📋 Training'],
  ['wholesale_supply', '📦 Wholesale'],
];

function tgUserId() {
  try { return String(window?.Telegram?.WebApp?.initDataUnsafe?.user?.id || '') || null; } catch { return null; }
}

function logEvent(event_type, extra = {}) {
  try {
    fetch('/api/market/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type, tg_user_id: tgUserId(), ...extra }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

function openChat(url) {
  try {
    const twa = window?.Telegram?.WebApp;
    if (twa?.openTelegramLink) { twa.openTelegramLink(url); return; }
  } catch {}
  window.open(url, '_blank');
}

function fmtPrice(p, cur) {
  if (p == null) return '';
  return `${Number(p).toLocaleString()} ${cur || 'ETB'}`;
}

export default function MarketPage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [items, setItems] = useState([]);
  const [shops, setShops] = useState([]);
  const [forYou, setForYou] = useState({ items: [], shops: [] });
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sheet, setSheet] = useState(null); // product in the detail sheet
  const debounceRef = useRef(null);
  const seenView = useRef(false);

  const load = useCallback(async (query, cat, offset = 0) => {
    offset ? setLoadingMore(true) : setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (cat) params.set('category', cat);
      if (offset) params.set('offset', String(offset));
      const r = await fetch(`/api/market/catalog?${params}`, { cache: 'no-store' });
      const j = await r.json();
      setItems(prev => offset ? [...prev, ...(j.items || [])] : (j.items || []));
      if (!offset) setShops(j.businesses || []);
      setHasMore(!!j.hasMore);
    } catch { /* keep whatever is on screen */ }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  // First load: expand the Mini App, log one view, fetch catalog + For-you.
  useEffect(() => {
    try { window?.Telegram?.WebApp?.ready?.(); window?.Telegram?.WebApp?.expand?.(); } catch {}
    if (!seenView.current) { seenView.current = true; logEvent('view_market'); }
    load('', '');
    const uid = tgUserId();
    if (uid) {
      fetch(`/api/market/for-you?tg_user_id=${uid}`, { cache: 'no-store' })
        .then(r => r.json()).then(j => setForYou({ items: j.items || [], shops: j.shops || [] }))
        .catch(() => {});
    }
  }, [load]);

  function onSearch(value) {
    setQ(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(value.trim(), category), 350);
  }
  function onCategory(cat) {
    setCategory(cat);
    load(q.trim(), cat);
  }
  function openSheet(p) {
    setSheet(p);
    logEvent('view_product', { business_id: p.business_id, product_id: p.id });
  }
  function orderNow(p) {
    logEvent('click_chat', { business_id: p.business_id, product_id: p.id || undefined });
    if (p.chat_url) openChat(p.chat_url);
  }

  const searching = q.trim().length > 0;
  const showForYou = !searching && !category && (forYou.items.length > 0 || forYou.shops.length > 0);

  return (
    <div className="mk">
      <style>{`
        .mk { min-height: 100vh; background: ${PAPER}; color: ${INK}; font-family: ${BODY};
              background-image: radial-gradient(1200px 400px at 50% -200px, rgba(79,163,138,0.07), transparent); }
        .mk * { box-sizing: border-box; }
        .mk-head { position: sticky; top: 0; z-index: 20; background: rgba(251,248,241,0.92);
                   backdrop-filter: blur(10px); border-bottom: 1px solid ${LINE}; padding: 14px 16px 10px; }
        .mk-title { font-family: ${SERIF}; font-size: 24px; font-weight: 500; letter-spacing: -0.02em; margin: 0; }
        .mk-sub { font-size: 12px; color: ${MUTED}; margin: 2px 0 10px; }
        .mk-search { display: flex; align-items: center; gap: 8px; background: #fff; border: 1.5px solid ${LINE};
                     border-radius: 14px; padding: 11px 14px; transition: border-color .2s, box-shadow .2s; }
        .mk-search:focus-within { border-color: ${TEAL}; box-shadow: 0 0 0 3px rgba(79,163,138,0.12); }
        .mk-search input { flex: 1; border: none; outline: none; background: transparent; font: inherit;
                           font-size: 15px; color: ${INK}; }
        .mk-search input::placeholder { color: ${MUTED}; }
        .mk-pills { display: flex; gap: 8px; overflow-x: auto; padding: 10px 16px; scrollbar-width: none; }
        .mk-pills::-webkit-scrollbar { display: none; }
        .mk-pill { flex-shrink: 0; border: 1px solid ${LINE}; background: #fff; color: ${INK};
                   font: inherit; font-size: 12.5px; font-weight: 500; padding: 7px 13px; border-radius: 999px;
                   cursor: pointer; transition: all .15s; white-space: nowrap; }
        .mk-pill.on { background: ${INK}; color: ${PAPER}; border-color: ${INK}; }
        .mk-body { padding: 4px 16px 90px; max-width: 640px; margin: 0 auto; }
        .mk-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
                    color: ${MUTED}; margin: 18px 0 10px; }
        .mk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .mk-card { background: #fff; border: 1px solid ${LINE}; border-radius: 16px; overflow: hidden;
                   cursor: pointer; animation: mkUp .4s ease both;
                   box-shadow: 0 1px 0 rgba(14,40,35,.04), 0 8px 24px -14px rgba(14,40,35,.10); }
        .mk-card:active { transform: scale(0.98); }
        ${Array.from({ length: 12 }, (_, i) => `.mk-card:nth-child(${i + 1}) { animation-delay: ${i * 45}ms; }`).join('\n')}
        @keyframes mkUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .mk-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: ${CREAM}; }
        .mk-img-fallback { width: 100%; aspect-ratio: 1; display: grid; place-items: center; background: ${CREAM};
                           font-family: ${SERIF}; font-size: 40px; color: ${GOLD}; }
        .mk-card-body { padding: 10px 12px 12px; }
        .mk-pname { font-size: 13.5px; font-weight: 600; line-height: 1.25; display: -webkit-box;
                    -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .mk-pname-am { font-size: 11.5px; color: ${MUTED}; margin-top: 1px; }
        .mk-price { font-family: ${SERIF}; font-size: 16px; font-weight: 600; margin-top: 5px; }
        .mk-biz { font-size: 11px; color: ${MUTED}; margin-top: 3px; overflow: hidden;
                  text-overflow: ellipsis; white-space: nowrap; }
        .mk-reason { font-size: 10.5px; color: ${TEAL}; font-style: italic; margin-top: 4px; }
        .mk-row { display: flex; gap: 12px; overflow-x: auto; scrollbar-width: none; padding-bottom: 4px; }
        .mk-row::-webkit-scrollbar { display: none; }
        .mk-row .mk-card { flex: 0 0 150px; }
        .mk-shop { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid ${LINE};
                   border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; }
        .mk-shop-logo { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: ${CREAM};
                        display: grid; place-items: center; font-family: ${SERIF}; color: ${GOLD}; font-size: 20px; flex-shrink: 0; }
        .mk-chat-btn { border: none; background: ${TEAL}; color: #fff; font: inherit; font-size: 12.5px;
                       font-weight: 600; padding: 9px 14px; border-radius: 10px; cursor: pointer; white-space: nowrap; }
        .mk-more { display: block; width: 100%; margin: 18px 0 0; border: 1px solid ${LINE}; background: #fff;
                   color: ${INK}; font: inherit; font-size: 14px; font-weight: 500; padding: 13px; border-radius: 12px; cursor: pointer; }
        .mk-empty { text-align: center; padding: 44px 20px; color: ${MUTED}; }
        .mk-empty .big { font-size: 36px; margin-bottom: 10px; }
        .mk-skel { border-radius: 16px; background: linear-gradient(100deg, ${CREAM} 40%, #fff 50%, ${CREAM} 60%);
                   background-size: 200% 100%; animation: mkShimmer 1.2s infinite; aspect-ratio: 0.8; }
        @keyframes mkShimmer { to { background-position: -200% 0; } }
        .mk-overlay { position: fixed; inset: 0; background: rgba(14,40,35,0.45); z-index: 40;
                      animation: mkFade .2s ease; }
        @keyframes mkFade { from { opacity: 0; } }
        .mk-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; background: ${PAPER};
                    border-radius: 22px 22px 0 0; max-height: 86vh; overflow-y: auto;
                    padding-bottom: calc(20px + env(safe-area-inset-bottom));
                    animation: mkSlide .32s cubic-bezier(.2,.9,.3,1.05); }
        @keyframes mkSlide { from { transform: translateY(100%); } }
        .mk-sheet-grip { width: 40px; height: 4px; border-radius: 999px; background: ${LINE}; margin: 10px auto; }
        .mk-sheet-img { width: 100%; max-height: 300px; object-fit: cover; display: block; }
        .mk-sheet-body { padding: 16px 20px 8px; }
        .mk-sheet-name { font-family: ${SERIF}; font-size: 24px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.2; }
        .mk-sheet-price { font-family: ${SERIF}; font-size: 21px; color: ${GOLD}; margin-top: 6px; }
        .mk-sheet-desc { font-size: 14px; line-height: 1.55; color: #3a514c; margin-top: 12px; }
        .mk-sheet-biz { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-top: 14px;
                        border-top: 1px solid ${LINE}; font-size: 13px; color: ${MUTED}; }
        .mk-order { display: block; width: calc(100% - 40px); margin: 16px auto 0; border: none;
                    background: #229ED9; color: #fff; font: inherit; font-size: 16px; font-weight: 600;
                    padding: 15px; border-radius: 14px; cursor: pointer;
                    box-shadow: 0 6px 20px -6px rgba(34,158,217,0.5); }
        .mk-order:active { transform: scale(0.985); }
        .mk-verified { color: ${TEAL}; }
      `}</style>

      {/* Header */}
      <div className="mk-head">
        <h1 className="mk-title">🛍️ MiniMe Market</h1>
        <div className="mk-sub">Every shop on MiniMe, one place — chat & order on Telegram</div>
        <div className="mk-search">
          <span aria-hidden>🔍</span>
          <input
            value={q}
            onChange={e => onSearch(e.target.value)}
            placeholder="What are you looking for? · ምን ይፈልጋሉ?"
            enterKeyHint="search"
          />
        </div>
      </div>

      {/* Category pills */}
      <div className="mk-pills">
        {CATEGORIES.map(([id, label]) => (
          <button key={id || 'all'} className={`mk-pill${category === id ? ' on' : ''}`} onClick={() => onCategory(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="mk-body">
        {/* For you — only when we truly know something about this user */}
        {showForYou && (
          <>
            <div className="mk-label">✨ For you</div>
            <div className="mk-row">
              {forYou.items.map(p => (
                <div key={p.id} className="mk-card" onClick={() => openSheet(p)}>
                  {p.image_url
                    ? <img className="mk-img" src={p.image_url} alt={p.name} loading="lazy" />
                    : <div className="mk-img-fallback">{(p.name || '?').charAt(0).toUpperCase()}</div>}
                  <div className="mk-card-body">
                    <div className="mk-pname">{p.name}</div>
                    <div className="mk-price">{fmtPrice(p.price, p.currency)}</div>
                    <div className="mk-biz">{p.business_name}{p.verified && <span className="mk-verified"> ✅</span>}</div>
                    <div className="mk-reason">{p.reason}</div>
                  </div>
                </div>
              ))}
            </div>
            {forYou.shops.map(s => (
              <div key={s.id} className="mk-shop">
                {s.logo_url ? <img className="mk-shop-logo" src={s.logo_url} alt="" /> : <div className="mk-shop-logo">{(s.name || '?').charAt(0)}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}{s.verified && <span className="mk-verified"> ✅</span>}</div>
                  <div className="mk-reason">{s.reason}</div>
                </div>
                <button className="mk-chat-btn" onClick={() => orderNow(s)}>💬 Chat</button>
              </div>
            ))}
          </>
        )}

        {/* Results */}
        <div className="mk-label">
          {searching ? `Results for “${q.trim()}”` : category ? (CATEGORIES.find(([id]) => id === category)?.[1] || 'Browse') : '🛒 Browse everything'}
        </div>

        {loading ? (
          <div className="mk-grid">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="mk-skel" />)}
          </div>
        ) : items.length === 0 && shops.length === 0 ? (
          <div className="mk-empty">
            <div className="big">😔</div>
            <div style={{ fontFamily: SERIF, fontSize: 18, color: INK }}>Nothing matched that… yet</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              Try different words, or ask our AI finder —{' '}
              <a href="https://t.me/MiniMeSearchBot" style={{ color: TEAL, fontWeight: 600 }}>@MiniMeSearchBot</a>
            </div>
          </div>
        ) : (
          <>
            <div className="mk-grid">
              {items.map(p => (
                <div key={p.id} className="mk-card" onClick={() => openSheet(p)}>
                  {p.image_url
                    ? <img className="mk-img" src={p.image_url} alt={p.name} loading="lazy" />
                    : <div className="mk-img-fallback">{(p.name || '?').charAt(0).toUpperCase()}</div>}
                  <div className="mk-card-body">
                    <div className="mk-pname">{p.name}</div>
                    {p.name_am && <div className="mk-pname-am">{p.name_am}</div>}
                    <div className="mk-price">{fmtPrice(p.price, p.currency)}</div>
                    <div className="mk-biz">{p.business_name}{p.verified && <span className="mk-verified"> ✅</span>}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Shops that can help — conversational fallback on thin results */}
            {searching && shops.length > 0 && (
              <>
                <div className="mk-label">💬 Shops that can help</div>
                {shops.map(s => (
                  <div key={s.id} className="mk-shop">
                    {s.logo_url ? <img className="mk-shop-logo" src={s.logo_url} alt="" /> : <div className="mk-shop-logo">{(s.name || '?').charAt(0)}</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}{s.verified && <span className="mk-verified"> ✅</span>}</div>
                      {s.tagline && <div style={{ fontSize: 12, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.tagline}</div>}
                      {s.total_reviews > 0 && <div style={{ fontSize: 11.5, color: GOLD, marginTop: 2 }}>⭐ {s.average_rating}/5 ({s.total_reviews})</div>}
                    </div>
                    <button className="mk-chat-btn" onClick={() => orderNow(s)}>💬 Chat</button>
                  </div>
                ))}
              </>
            )}

            {hasMore && (
              <button className="mk-more" disabled={loadingMore} onClick={() => load(q.trim(), category, items.length)}>
                {loadingMore ? 'Loading…' : 'Show more ↓'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Product detail sheet */}
      {sheet && (
        <>
          <div className="mk-overlay" onClick={() => setSheet(null)} />
          <div className="mk-sheet" role="dialog" aria-modal="true">
            <div className="mk-sheet-grip" />
            {sheet.image_url && <img className="mk-sheet-img" src={sheet.image_url} alt={sheet.name} />}
            <div className="mk-sheet-body">
              <div className="mk-sheet-name">{sheet.name}</div>
              {sheet.name_am && <div style={{ fontSize: 14, color: MUTED, marginTop: 2 }}>{sheet.name_am}</div>}
              <div className="mk-sheet-price">{fmtPrice(sheet.price, sheet.currency)}</div>
              {sheet.description && <div className="mk-sheet-desc">{sheet.description}</div>}
              <div className="mk-sheet-biz">
                <span>Sold by</span>
                <strong style={{ color: INK }}>{sheet.business_name}</strong>
                {sheet.verified && <span className="mk-verified">✅ Verified</span>}
              </div>
            </div>
            <button className="mk-order" onClick={() => orderNow(sheet)}>
              💬 Order on Telegram
            </button>
            <div style={{ textAlign: 'center', fontSize: 11.5, color: MUTED, marginTop: 8 }}>
              Opens a chat with the shop — ask anything, pay there.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
