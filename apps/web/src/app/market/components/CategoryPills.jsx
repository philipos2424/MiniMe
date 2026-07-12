'use client';
import { CATEGORIES } from '../lib';

export default function CategoryPills({ category, onCategory }) {
  return (
    <div className="mk-pills">
      {CATEGORIES.map(([id, label]) => (
        <button key={id || 'all'} className={`mk-pill${category === id ? ' on' : ''}`} onClick={() => onCategory(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}
