'use client';
import { INK, MUTED, SERIF } from '../lib';
import ProductGrid from './ProductGrid';
import ShopRow from './ShopRow';

export default function SavedTab({ loading, favorites, follows, onOpen, onFav, favIds, onChat, onOpenShop }) {
  const hasAny = (favorites?.length || 0) > 0 || (follows?.length || 0) > 0;

  if (loading) {
    return (
      <div className="mk-grid">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="mk-skel" />)}
      </div>
    );
  }

  if (!hasAny) {
    return (
      <div className="mk-empty">
        <div className="big">🤍</div>
        <div style={{ fontFamily: SERIF, fontSize: 18, color: INK }}>Nothing saved yet</div>
        <div style={{ fontSize: 13, marginTop: 6, color: MUTED }}>
          Tap the heart on a product to save it here, or follow a shop to keep up with what they add.
        </div>
      </div>
    );
  }

  return (
    <div>
      {follows?.length > 0 && (
        <>
          <div className="mk-label">🏪 Shops you follow</div>
          {follows.map(s => (
            <ShopRow key={s.id} s={s} onChat={onChat} onOpenShop={onOpenShop} />
          ))}
        </>
      )}
      {favorites?.length > 0 && (
        <>
          <div className="mk-label">❤️ Saved products</div>
          <ProductGrid items={favorites} onOpen={onOpen} favIds={favIds} onFav={onFav} />
        </>
      )}
    </div>
  );
}
