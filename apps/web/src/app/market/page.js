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
import { CATEGORIES, PRICE_RANGES, SELL_DEEPLINK, tgUserId, logEvent, openChat, useVoiceSearch, shareLink } from './lib';
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
import Tracker from '../../components/Tracker';
import { track } from '../../lib/track';

export default function MarketPage() {
  const [tab, setTab] = useState('market'); // market | saved
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('newest');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [priceRange, setPriceRange] = useState(null); // id from PRICE_RANGES, or null
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
  // Logging is deliberately slower than fetching. The 350ms fetch debounce is
  // right for feeling responsive, but logging on that cadence wrote one
  // search_logs row per burst of typing — "Ph", "Pho", "Phon", "Phone" — which
  // was 44% of the entire search log. settleRef waits for the searcher to
  // actually stop typing; resultRef/pendingRef then pair that final query with
  // its real result count, whichever of the two resolves last.
  const settleRef = useRef(null);
  const resultRef = useRef(null);   // { q, count } of the last completed load
  const pendingRef = useRef(null);  // query waiting to be logged
  const seenView = useRef(false);
  const uid = tgUserId();
  const canEngage = !!uid; // hearts/follow/review only make sense inside Telegram

  const { voiceState, voiceErr, startVoice } = useVoiceSearch(text => {
    setQ(text);
    setNotifyState('idle');
    clearTimeout(debounceRef.current);
    clearTimeout(settleRef.current);
    const trimmed = text.trim();
    // A finished transcription is already a settled query — mark it pending and
    // let the load resolve the count, same as a tapped suggestion.
    pendingRef.current = { q: trimmed, via: 'voice', intent: 'search.query.submit' };
    load(trimmed, category, sort, verifiedOnly, priceRange, 0);
  });

  // Voice-search STARTS are tracked separately from voice results: the gap
  // between the two is the transcription failure rate, which we currently can't
  // see at all (useVoiceSearch swallows errors into local state).
  function onMic() {
    track('click', { intent: 'search.voice.start' });
    startVoice();
  }

  // Emit the one search_logs row for `query`, once its count is known. Called
  // from both sides of the race (settle timer, load completion); whichever
  // arrives second does the work, and the pending marker makes it idempotent.
  const flushSearchLog = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    const r = resultRef.current;
    if (!r || r.q !== p.q) return; // count not in yet — the other side will flush
    pendingRef.current = null;
    logEvent('view_market', { meta: { q: p.q, results_count: r.count } });
    track('submit', { intent: p.intent, meta: { q: p.q, via: p.via, results_count: r.count } });
  }, []);

  const load = useCallback(async (query, cat, sortVal, verified, priceRangeId, offset = 0) => {
    offset ? setLoadingMore(true) : setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (cat) params.set('category', cat);
      if (sortVal && sortVal !== 'newest') params.set('sort', sortVal);
      if (verified) params.set('verified', '1');
      const range = PRICE_RANGES.find(([id]) => id === priceRangeId)?.[1];
      if (range) {
        if (range.min != null) params.set('price_min', String(range.min));
        if (range.max != null) params.set('price_max', String(range.max));
      }
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
      // Zero-result searches are the highest-value signal the Market produces —
      // an unmet demand we could recruit a seller for. search_logs records the
      // query but nothing recorded that it came back empty at the UI level.
      if (query && !offset && !(j.items || []).length && !(j.businesses || []).length) {
        track('view', { intent: 'search.zero_result', meta: { q: query, category: cat || undefined } });
      }
      // Record the count for this query, then settle any pending log. A Market
      // zero-result must reach search_logs as 0, not null — the demand engine
      // filters on `results_count = 0`, so null rows were invisible to it and
      // every unmet Market search was being dropped on the floor.
      if (query && !offset) {
        resultRef.current = { q: query, count: (j.items || []).length + (j.businesses || []).length };
        flushSearchLog();
      }
    } catch { /* keep whatever is on screen */ }
    finally { setLoading(false); setLoadingMore(false); }
  }, [flushSearchLog]);

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
    load('', '', 'newest', false, null);
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
    clearTimeout(settleRef.current);
    const trimmed = value.trim();
    // Fetch quickly so the grid feels live…
    debounceRef.current = setTimeout(() => {
      load(trimmed, category, sort, verifiedOnly, priceRange);
    }, 350);
    // …but log only once the typing has actually stopped, so /api/market/suggest
    // learns "phone" rather than "Ph"/"Pho"/"Phon"/"Phone".
    if (trimmed.length >= 2) {
      settleRef.current = setTimeout(() => {
        pendingRef.current = { q: trimmed, via: 'text', intent: 'search.query.submit' };
        flushSearchLog();
      }, 1200);
    }
  }

  function pickSearch(text) {
    setQ(text);
    setNotifyState('idle');
    clearTimeout(debounceRef.current);
    // A tap is an explicit submit — no need to wait for typing to settle, but
    // still route through the pending marker so it carries a real count.
    clearTimeout(settleRef.current);
    const trimmed = text.trim();
    // Mark pending BEFORE kicking off the load — load() flushes on completion,
    // and relying on the await to yield first would be a silent ordering trap.
    if (trimmed.length >= 2) {
      // A tapped suggestion is a refinement, not a fresh search — separating the
      // two is what makes the search funnel's click-through rate meaningful.
      pendingRef.current = { q: trimmed, via: 'text', intent: 'search.refine' };
    }
    load(trimmed, category, sort, verifiedOnly, priceRange);
  }

  function onSort(next) {
    setSort(next);
    load(q.trim(), category, next, verifiedOnly, priceRange);
  }

  function onVerified(next) {
    setVerifiedOnly(next);
    load(q.trim(), category, sort, next, priceRange);
  }

  function onPriceRange(next) {
    setPriceRange(next);
    load(q.trim(), category, sort, verifiedOnly, next);
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
    load(q.trim(), cat, sort, verifiedOnly, priceRange);
  }
  function openSheet(p) {
    setSheet(p);
    logEvent('view_product', { business_id: p.business_id, product_id: p.id });
    track('click', { intent: 'search.result.click', meta: { kind: 'product' } });
  }
  function orderNow(p) {
    logEvent('click_chat', { business_id: p.business_id, product_id: p.id || undefined });
    track('click', { intent: 'market.chat.open', meta: { kind: p.id ? 'product' : 'shop' } });
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
      <Tracker surface="market" />

      {tab === 'market' ? (
        <>
          <MarketHeader q={q} onSearch={onSearch} voiceState={voiceState} voiceErr={voiceErr} onMic={onMic} onPickSearch={pickSearch} />
          <CategoryPills category={category} onCategory={onCategory} />
          <FilterBar sort={sort} onSort={onSort} verifiedOnly={verifiedOnly} onVerified={onVerified}
            priceRange={priceRange} onPriceRange={onPriceRange} />

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
                  <button className="mk-more" disabled={loadingMore} onClick={() => load(q.trim(), category, sort, verifiedOnly, priceRange, items.length)}>
                    {loadingMore ? 'Loading…' : 'Show more ↓'}
                  </button>
                )}
              </>
            )}

            {/* Supply capture — quiet, never competes with the buyer flow */}
            <div className="mk-sell" onClick={() => openChat(SELL_DEEPLINK)}>
              🏪 Own a shop? <strong>Sell on MiniMe →</strong>
            </div>
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
