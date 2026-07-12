'use client';
/**
 * SearchSuggest — chips shown under the search box: recent searches when
 * focused+empty, popular prefix matches while typing (debounced). Tapping a
 * chip runs that search immediately.
 */
import { useEffect, useRef, useState } from 'react';
import { tgUserId } from '../lib';

export default function SearchSuggest({ q, focused, onPick }) {
  const [recent, setRecent] = useState([]);
  const [popular, setPopular] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!focused) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const uid = tgUserId();
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (uid) params.set('tg_user_id', uid);
      fetch(`/api/market/suggest?${params}`, { cache: 'no-store' })
        .then(r => r.json())
        .then(j => { setRecent(j.recent || []); setPopular(j.popular || []); })
        .catch(() => {});
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [focused, q]);

  if (!focused) return null;

  const showRecent = !q.trim() && recent.length > 0;
  const showPopular = popular.length > 0 && popular.some(p => p.toLowerCase() !== q.trim().toLowerCase());
  if (!showRecent && !showPopular) return null;

  return (
    <div className="mk-chips" style={{ marginTop: 8 }}>
      {showRecent && recent.map(text => (
        <button key={`r-${text}`} className="mk-chip" onMouseDown={() => onPick(text)}>
          🕐 {text}
        </button>
      ))}
      {showPopular && popular.map(text => (
        <button key={`p-${text}`} className="mk-chip" onMouseDown={() => onPick(text)}>
          🔥 {text}
        </button>
      ))}
    </div>
  );
}
