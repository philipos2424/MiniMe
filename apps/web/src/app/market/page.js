'use client';
/**
 * /market — MiniMe Market: customer-facing marketplace Mini App.
 *
 * Public (no merchant auth — customers aren't merchants, so this page reads
 * window.Telegram directly instead of the dashboard's TelegramProvider).
 * Browse every discoverable business's products; type what you need and get
 * products AND shops to chat with; personalized "For you" row from the
 * user's own activity. Ordering hands off to the business's Telegram bot.
 *
 * State container only — visual pieces live in ./components, shared helpers
 * in ./lib.js.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORIES, tgUserId, logEvent, openChat, useVoiceSearch, shareLink } from './lib';
import { MARKET_CSS } from './components/styles';
import MarketHeader from './components/MarketHeader';
import CategoryPills from './components/CategoryPills';
import FilterBar from './components/FilterBar';
import ProductGrid from './components/ProductGrid';
import ProductRow from './components/ProductRow';
import ShopRow from './components/ShopRow';
import ProductSheet from './components/ProductSheet';
import ShopView from './components/ShopView';
import EmptyState from './components/EmptyState';
import BottomTabs from './components/BottomTabs';
import SavedTab from './components/SavedTab';

export default function MarketPage() {
  const [tab, setTab] = useState('market'); // market | saved
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('newest');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [items, setItems] = useState([]);
  const [shops, setShops] = useState([]);
  const [forYou, setForYou] = useState({ items: [], shops: [] });
  const [trending, setTrending] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sheet, setSheet] = useState(null); // product in the detail sheet
  const [shopId, setShopId] = useState(null); // open shop view, if any
  const [assist, setAssist] = useState('');
  const [chips, setChips] = useState([]);
  const [notifyState, setNotifyState] = useState('idle'); // idle | saving | done | bot

  const [favIds, setFavIds] = useState(new Set());
  const [favItems, setFavItems] = useState([]);
  const [followIds, setFollowIds] = useState(new Set());
  const [followShops, setFollowShops] = useState([]);
  const [savedLoading, setSavedLoading] = useState(true);

  const debounceRef = useRef(null);
  const seenView = useRef(false);
  const uid = tgUserId();
  const canEngage = !!uid; // hearts/follow/review only make sense inside Telegram

  const { voiceState, voiceErr, startVoice } = useVoiceSearch(text => {
    setQ(text);
    setNotifyState('idle');
    clearTimeout(debounceRef.current);
    load(text.trim(), category, sort, verifiedOnly);
    logEvent('view_market', { meta: { q: text.trim(), via: 'voice' } });
  });

  const load = useCallback(async (query, cat, sortVal, verified, offset = 0) => {
    offset ? setLoadingMore(true) : setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (cat) params.set('category', cat);
      if (sortVal && sortVal !== 'newest') params.set('sort', sortVal);
      if (verified) params.set('verified', '1');
      if (offset) params.set('offset', String(offset));
      const r = await fetch(`/api/market/catalog?${params}`, { cache: 'no-store' });
      const j = await r.json();
      setItems(prev => offset ? [...prev, ...(j.items || [])] : (j.items || []));
      if (!offset) {
        setShops(j.businesses || []);
        setAssist(j.assist || '');
        setChips(j.chips || []);
        if (j.trending) setTrending(j.trending);
      }
      setHasMore(!!j.hasMore);
    } catch { /* keep whatever is on screen */ }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  const loadSaved = useCallback(() => {
    if (!uid) { setSavedLoading(false); return; }
    setSavedLoading(true);
    Promise.all([
      fetch(`/api/market/favorites?tg_user_id=${uid}`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ product_ids: [], items: [] })),
      fetch(`/api/market/follows?tg_user_id=${uid}`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ business_ids: [], shops: [] })),
    ]).then(([favs, follows]) => {
      setFavIds(new Set(favs.product_ids || []));
      setFavItems(favs.items || []);
      setFollowIds(new Set(follows.business_ids || []));
      setFollowShops(follows.shops || []);
    }).finally(() => setSavedLoading(false));
  }, [uid]);

  // First load: expand the Mini App, log one view, fetch catalog + For-you + saved.
  useEffect(() => {
    try { window?.Telegram?.WebApp?.ready?.(); window?.Telegram?.WebApp?.expand?.(); } catch {}
    if (!seenView.current) { seenView.current = true; logEvent('view_market'); }
    load('', '', 'newest', false);
    loadSaved();
    if (uid) {
      fetch(`/api/market/for-you?tg_user_id=${uid}`, { cache: 'no-store' })
        .then(r => r.json()).then(j => setForYou({ items: j.items || [], shops: j.shops || [] }))
        .catch(() => {});
    }
  }, [load, loadSaved]); // eslint-disable-line

  // Deep-link entry: /market?product=<id> or /market?shop=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('product');
    const shopParam = params.get('shop');
    if (productId) {
      fetch(`/api/market/catalog?id=${productId}`, { cache: 'no-store' })
        .then(r => r.json()).then(j => { if (j.items?.[0]) openSheet(j.items[0]); })
        .catch(() => {});
    } else if (shopParam) {
      setShopId(shopParam);
    }
    if (productId || shopParam) {
      const url = new URL(window.location.href);
      url.searchParams.delete('product');
      url.searchParams.delete('shop');
      window.history.replaceState({}, '', url.toString());
    }
  }, []); // eslint-disable-line

  function onSearch(value) {
    setQ(value);
    setNotifyState('idle');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(value.trim(), category, sort, verifiedOnly), 350);
  }

  function onSort(next) {
    setSort(next);
    load(q.trim(), category, next, verifiedOnly);
  }

  function onVerified(next) {
    setVerifiedOnly(next);
    load(q.trim(), category, sort, next);
  }

  // "We don't have it yet — message me when it's available." Saves the query to
  // the waitlist; the notify cron messages them via @MiniMeSearchBot when a
  // matching shop joins. Only works inside Telegram (needs a chat to message).
  async function notifyMe() {
    if (!uid) { setNotifyState('bot'); return; }
    setNotifyState('saving');
    try {
      const r = await fetch('/api/market/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_user_id: uid, q: q.trim(), category }),
      });
      const j = await r.json();
      setNotifyState(j.needs_telegram ? 'bot' : 'done');
    } catch { setNotifyState('bot'); }
  }

  function onCategory(cat) {
    setCategory(cat);
    load(q.trim(), cat, sort, verifiedOnly);
  }
  function openSheet(p) {
    setSheet(p);
    logEvent('view_product', { business_id: p.business_id, product_id: p.id });
  }
  function orderNow(p) {
    logEvent('click_chat', { business_id: p.business_id, product_id: p.id || undefined });
    if (p.chat_url) openChat(p.chat_url);
  }
  function openShop(businessId) {
    if (!businessId) return;
    setSheet(null);
    setShopId(businessId);
  }
  function shareProduct(p) {
    logEvent('share', { business_id: p.business_id, product_id: p.id });
    openChat(shareLink({ product: p }));
  }

  async function toggleFav(p) {
    if (!uid) return;
    const isFav = favIds.has(p.id);
    // Optimistic update
    setFavIds(prev => { const n = new Set(prev); isFav ? n.delete(p.id) : n.add(p.id); return n; });
    setFavItems(prev => isFav ? prev.filter(x => x.id !== p.id) : [p, ...prev]);
    logEvent(isFav ? 'unfavorite' : 'favorite', { business_id: p.business_id, product_id: p.id });
    try {
      await fetch('/api/market/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_user_id: uid, product_id: p.id, action: isFav ? 'remove' : 'add' }),
      });
    } catch {}
  }

  async function toggleFollow(shop) {
    if (!uid || !shop?.id) return;
    const isFollowing = followIds.has(shop.id);
    setFollowIds(prev => { const n = new Set(prev); isFollowing ? n.delete(shop.id) : n.add(shop.id); return n; });
    setFollowShops(prev => isFollowing ? prev.filter(x => x.id !== shop.id) : [{ ...shop, chat_url: shop.chat_url }, ...prev]);
    logEvent(isFollowing ? 'unfollow' : 'follow', { business_id: shop.id });
    try {
      await fetch('/api/market/follows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_user_id: uid, business_id: shop.id, action: isFollowing ? 'remove' : 'add' }),
      });
    } catch {}
  }

  const searching = q.trim().length > 0;
  const isHome = !searching && !category;
  const showForYou = isHome && (forYou.items.length > 0 || forYou.shops.length > 0);
  const showTrending = isHome && trending.length > 0;

  return (
    <div className="mk">
      <style>{MARKET_CSS}</style>

      {tab === 'market' ? (
        <>
          <MarketHeader q={q} onSearch={onSearch} voiceState={voiceState} voiceErr={voiceErr} onMic={startVoice} />
          <CategoryPills category={category} onCategory={onCategory} />
          {(searching || category) && (
            <FilterBar sort={sort} onSort={onSort} verifiedOnly={verifiedOnly} onVerified={onVerified} />
          )}

          <div className="mk-body">
            {/* For you — only when we truly know something about this user */}
            {showForYou && (
              <>
                <div className="mk-label">✨ For you</div>
                <ProductRow items={forYou.items} onOpen={openSheet} favIds={favIds} onFav={canEngage ? toggleFav : undefined} />
                {forYou.shops.map(s => (
                  <ShopRow key={s.id} s={s} onChat={orderNow} onOpenShop={openShop} />
                ))}
              </>
            )}

            {/* Popular right now — social proof, makes the Market feel alive */}
            {showTrending && (
              <>
                <div className="mk-label">🔥 Popular right now</div>
                <ProductRow items={trending} onOpen={openSheet} favIds={favIds} onFav={canEngage ? toggleFav : undefined} />
              </>
            )}

            {/* The Market talks back — assist line + tappable refinements */}
            {!loading && assist && (
              <div className="mk-assist"><span aria-hidden>🤖</span><span>{assist}</span></div>
            )}
            {!loading && chips.length > 1 && (
              <div className="mk-chips">
                {chips.map(c => {
                  const label = CATEGORIES.find(([id]) => id === c)?.[1] || c.replace(/_/g, ' ');
                  return <button key={c} className="mk-chip" onClick={() => onCategory(c)}>{label}</button>;
                })}
              </div>
            )}

            {/* Results */}
            <div className="mk-label">
              {searching ? `Results for "${q.trim()}"` : category ? (CATEGORIES.find(([id]) => id === category)?.[1] || 'Browse') : '🛒 Browse everything'}
            </div>

            {loading ? (
              <div className="mk-grid">
                {Array.from({ length: 6 }, (_, i) => <div key={i} className="mk-skel" />)}
              </div>
            ) : items.length === 0 && shops.length === 0 ? (
              <EmptyState q={q} notifyState={notifyState} onNotify={notifyMe} />
            ) : (
              <>
                <ProductGrid items={items} onOpen={openSheet} favIds={favIds} onFav={canEngage ? toggleFav : undefined} />

                {/* Shops that can help — conversational fallback on thin results */}
                {searching && shops.length > 0 && (
                  <>
                    <div className="mk-label">💬 Shops that can help</div>
                    {shops.map(s => (
                      <ShopRow key={s.id} s={s} onChat={orderNow} onOpenShop={openShop} />
                    ))}
                  </>
                )}

                {hasMore && (
                  <button className="mk-more" disabled={loadingMore} onClick={() => load(q.trim(), category, sort, verifiedOnly, items.length)}>
                    {loadingMore ? 'Loading…' : 'Show more ↓'}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mk-head">
            <h1 className="mk-title">❤️ Saved</h1>
            <div className="mk-sub">Products you've hearted and shops you follow</div>
          </div>
          <div className="mk-body">
            <SavedTab
              loading={savedLoading}
              favorites={favItems}
              follows={followShops}
              onOpen={openSheet}
              onFav={toggleFav}
              favIds={favIds}
              onChat={orderNow}
              onOpenShop={openShop}
            />
          </div>
        </>
      )}

      <ProductSheet
        sheet={sheet}
        onClose={() => setSheet(null)}
        onOrder={orderNow}
        onOpenShop={openShop}
        isFav={sheet ? favIds.has(sheet.id) : false}
        onFav={toggleFav}
        canEngage={canEngage}
        onShare={shareProduct}
      />

      {shopId && (
        <ShopView
          businessId={shopId}
          onClose={() => setShopId(null)}
          onOpenProduct={openSheet}
          favIds={favIds}
          onFav={canEngage ? toggleFav : undefined}
          isFollowing={followIds.has(shopId)}
          onFollow={toggleFollow}
          canEngage={canEngage}
        />
      )}

      <BottomTabs tab={tab} onTab={setTab} savedCount={favItems.length + followShops.length} />
    </div>
  );
}
