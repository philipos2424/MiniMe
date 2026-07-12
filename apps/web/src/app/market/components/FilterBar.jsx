'use client';
import { SORTS, PRICE_RANGES } from '../lib';

export default function FilterBar({ sort, onSort, verifiedOnly, onVerified, priceRange, onPriceRange }) {
  return (
    <div className="mk-filter">
      {SORTS.map(([id, label]) => (
        <button key={id} className={`mk-sort${sort === id ? ' on' : ''}`} onClick={() => onSort(id)}>
          {label}
        </button>
      ))}
      <button className={`mk-sort${verifiedOnly ? ' on' : ''}`} onClick={() => onVerified(!verifiedOnly)}>
        ✅ Verified only
      </button>
      {PRICE_RANGES.map(([id, { label }]) => (
        <button key={id} className={`mk-sort${priceRange === id ? ' on' : ''}`}
          onClick={() => onPriceRange(priceRange === id ? null : id)}>
          {label} ETB
        </button>
      ))}
    </div>
  );
}
