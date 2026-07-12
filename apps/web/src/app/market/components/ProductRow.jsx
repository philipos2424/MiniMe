'use client';
import ProductCard from './ProductCard';

/** Horizontal scroller — For you / Popular right now. */
export default function ProductRow({ items, onOpen, favIds, onFav }) {
  return (
    <div className="mk-row">
      {items.map(p => (
        <ProductCard key={p.id} p={p} onOpen={onOpen}
          isFav={favIds?.has(p.id)} onFav={onFav} />
      ))}
    </div>
  );
}
