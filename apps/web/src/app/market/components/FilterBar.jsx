'use client';
import { SORTS } from '../lib';

export default function FilterBar({ sort, onSort, verifiedOnly, onVerified }) {
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
    </div>
  );
}
