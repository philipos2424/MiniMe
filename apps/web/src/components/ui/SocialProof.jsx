'use client';
import { useEffect, useRef, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';

// Last known value, keyed by the peer scope we asked for, so a re-opened
// paywall shows numbers immediately instead of flashing empty.
const lastKnown = new Map();

// How often the badge refreshes while it's on screen.
const POLL_MS = 20000;

/**
 * Live proof for the paywall.
 *
 * Two numbers, in this order:
 *   1. Replies MiniMe has written — the biggest figure, and the only one that
 *      visibly moves. It's also the product working rather than accounts
 *      existing, which is what a buyer is actually weighing.
 *   2. Shops like yours, near you — "14 cosmetics shops in Addis Ababa"
 *      outperforms any national total, because those are the competition.
 *      Falls back to the city, then to the national signup count.
 *
 * Renders NOTHING until real numbers arrive, and nothing at all if the platform
 * hasn't enough activity for an honest claim. No skeleton, no placeholder: this
 * sits directly above a payment button and an empty space beats a figure we
 * can't stand behind.
 */
export function useSocialProof() {
  const { business } = useTelegram() || {};
  const category = business?.category || '';
  const city = business?.location || '';
  const key = `${category}|${city}`;

  const [proof, setProof] = useState(() => lastKnown.get(key) || null);

  useEffect(() => {
    let alive = true;
    let timer = null;

    async function load() {
      try {
        const qs = new URLSearchParams();
        if (category) qs.set('category', category);
        if (city) qs.set('city', city);
        const r = await fetch(`/api/stats/social-proof?${qs}`, { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (!alive) return;
        lastKnown.set(key, d);
        setProof(d);
      } catch {
        // Stay on the last known value; never surface an error here.
      } finally {
        if (alive) timer = setTimeout(load, POLL_MS);
      }
    }

    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [key, category, city]);

  return proof?.signups ? proof : null;
}

/** Briefly tints when the underlying number changes, so growth is felt. */
function LiveNumber({ value, color }) {
  const [bumped, setBumped] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current !== value && prev.current !== undefined) {
      setBumped(true);
      const t = setTimeout(() => setBumped(false), 1400);
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);

  return (
    <strong style={{ color: bumped ? '#4FA38A' : color, fontWeight: 700, transition: 'color .4s ease' }}>
      {value.toLocaleString('en-US')}
    </strong>
  );
}

/** "14 cosmetics shops in Addis Ababa" → falls back to city, then national. */
function peerLine(proof) {
  const p = proof.peers;
  if (p?.scope === 'category_city') {
    const cat = String(p.category).toLowerCase();
    return `${p.count.toLocaleString('en-US')} ${cat} ${p.count === 1 ? 'shop' : 'shops'} in ${p.city} use it`;
  }
  if (p?.scope === 'city') {
    return `${p.count.toLocaleString('en-US')} shops in ${p.city} use it`;
  }
  return `${proof.signups.toLocaleString('en-US')} businesses use it`;
}

export default function SocialProof({ tone = 'light', align = 'center', style = {} }) {
  const proof = useSocialProof();
  if (!proof) return null;

  const muted = tone === 'dark' ? '#94A3B8' : '#6B7A75';
  const strong = tone === 'dark' ? '#E2E8F0' : '#0E2823';

  return (
    <div style={{ fontSize: 12, lineHeight: 1.55, color: muted, textAlign: align, ...style }}>
      {/* The replies count leads: it's the largest, it moves on its own, and
          it's the product doing its job rather than accounts existing. */}
      {proof.replies ? (
        <div>
          MiniMe has written{' '}
          <LiveNumber value={proof.replies} color={strong} /> replies for Ethiopian shops
        </div>
      ) : null}
      <div style={{ marginTop: proof.replies ? 2 : 0 }}>{peerLine(proof)}</div>
    </div>
  );
}
