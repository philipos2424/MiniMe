'use client';
/**
 * Live "N people searched on MiniMe" social-proof counter.
 * Fetches the cached /api/public/search-count (30-day search_logs total across
 * bot + web + Market). Renders nothing until the number is in and above a small
 * floor, so a brand-new/empty environment doesn't show "0 searches".
 */
import { useEffect, useState } from 'react';

export default function SearchCount({ style, floor = 10, tone = 'light' }) {
  const [count, setCount] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/public/search-count')
      .then(r => r.json())
      .then(d => { if (alive) setCount(Number(d?.count) || 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (count == null || count < floor) return null;

  const color = tone === 'dark' ? 'rgba(255,255,255,0.6)' : '#4A5E5A';
  const dot = '#4FA38A';

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color, fontWeight: 500, ...style }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, boxShadow: `0 0 0 3px ${dot}22` }} />
      {count.toLocaleString()} searches on MiniMe this month
    </div>
  );
}
