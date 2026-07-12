'use client';
import ProductCard from './ProductCard';

export default function ProductGrid({ items, onOpen, favIds, onFav }) {
  return (
    <div className="mk-grid">
      {items.map(p => (
        <ProductCard key={p.id} p={p} onOpen={onOpen} showAm
          isFav={favIds?.has(p.id)} onFav={onFav} />
      ))}
    </div>
  );
}
