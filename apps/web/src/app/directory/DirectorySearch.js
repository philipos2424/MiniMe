'use client';
/**
 * Client-side interactive search for /directory.
 * Debounces input → calls /api/directory/search → updates results in-place.
 * Initial results are SSR-injected so the page loads instantly with content.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const CATEGORIES = {
  branding_design:       { label: 'Branding & Design',       emoji: '🎨' },
  printing_signage:      { label: 'Printing & Signage',      emoji: '🖨️' },
  photography_video:     { label: 'Photography & Video',     emoji: '📸' },
  catering_food:         { label: 'Catering & Food',         emoji: '🍽️' },
  food_beverage:         { label: 'Restaurants & Cafés',     emoji: '☕' },
  it_tech:               { label: 'IT & Tech',               emoji: '💻' },
  events_entertainment:  { label: 'Events & Entertainment',  emoji: '🎉' },
  clothing_fashion:      { label: 'Clothing & Fashion',      emoji: '👗' },
  beauty_wellness:       { label: 'Beauty & Wellness',       emoji: '💆' },
  construction_interior: { label: 'Construction & Interior', emoji: '🏗️' },
  transport_delivery:    { label: 'Transport & Delivery',    emoji: '🚚' },
  training_consulting:   { label: 'Training & Consulting',   emoji: '📋' },
  wholesale_supply:      { label: 'Wholesale & Supply',      emoji: '📦' },
  electronics_phones:    { label: 'Electronics & Phones',    emoji: '📱' },
};

const C = {
  bg: '#FBF8F1', surface: '#FFFFFF', border: '#E4DED1',
  ink: '#0E2823', inkSoft: '#4A5E5A', muted: '#8A9590',
  teal: '#4FA38A', tealLight: 'rgba(79,163,138,0.10)',
};

function BusinessCard({ biz }) {
  const catInfo = CATEGORIES[biz.category] || { label: biz.category || 'Business', emoji: '🏢' };
  const tags = Array.isArray(biz.tags) ? biz.tags.slice(0, 4) : [];
  const desc = biz.tagline
    ? biz.tagline
    : biz.description
      ? biz.description.slice(0, 120) + (biz.description.length > 120 ? '…' : '')
      : null;
  const deepLink = `https://t.me/${biz.telegram_bot_username}?start=minime_search`;
  const profileLink = `/directory/${biz.telegram_bot_username}`;
  const photo = biz.logo_url || biz.first_product_image || null;
  const hasRating = biz.total_reviews && biz.total_reviews > 0;

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 20, overflow: 'hidden',
      boxShadow: '0 1px 0 rgba(14,40,35,.04), 0 8px 24px -12px rgba(14,40,35,.10)',
    }}>
      {/* Cover photo */}
      {photo && (
        <div style={{ height: 140, overflow: 'hidden', background: C.tealLight }}>
          <img src={photo} alt={biz.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      <div style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <a href={profileLink} style={{ textDecoration: 'none' }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                {biz.name}
              </div>
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 12, color: C.teal, fontWeight: 500 }}>
                {catInfo.emoji} {catInfo.label}
              </span>
              <span style={{ fontSize: 12, color: hasRating ? '#D4A017' : C.muted, fontWeight: 500 }}>
                {hasRating
                  ? `⭐ ${biz.average_rating}/5 (${biz.total_reviews})`
                  : '⭐ New'}
              </span>
            </div>
          </div>
          <a href={deepLink} target="_blank" rel="noopener noreferrer"
            style={{ flexShrink: 0, background: C.teal, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            💬 Chat
          </a>
        </div>
        {desc && (
          <p style={{ fontSize: 14, color: C.inkSoft, margin: '0 0 10px', lineHeight: 1.55 }}>{desc}</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {biz.location && <span style={{ fontSize: 12, color: C.muted }}>📍 {biz.location}</span>}
          {tags.map(tag => (
            <span key={tag} style={{ fontSize: 11, fontWeight: 500, color: C.inkSoft, background: C.tealLight, padding: '3px 8px', borderRadius: 6 }}>
              {tag}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>@{biz.telegram_bot_username}</div>
      </div>
    </div>
  );
}

export default function DirectorySearch({ initialBusinesses = [], initialQ = '', initialCat = '' }) {
  const [q, setQ]           = useState(initialQ);
  const [cat, setCat]       = useState(initialCat);
  const [businesses, setBusinesses] = useState(initialBusinesses);
  const [loading, setLoading]       = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback(async (query, category) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (category)     params.set('cat', category);
      params.set('limit', '30');
      const res = await fetch(`/api/directory/search?${params}`);
      const json = await res.json();
      setBusinesses(json.businesses || []);
      // Update URL without page reload
      const url = new URL(window.location.href);
      query.trim() ? url.searchParams.set('q', query.trim()) : url.searchParams.delete('q');
      category     ? url.searchParams.set('cat', category)   : url.searchParams.delete('cat');
      window.history.replaceState({}, '', url.toString());
    } catch {}
    setLoading(false);
  }, []);

  // Debounce text input
  const handleQueryChange = (val) => {
    setQ(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val, cat), 350);
  };

  const handleCatChange = (newCat) => {
    setCat(newCat);
    search(q, newCat);
  };

  return (
    <div>
      {/* Search bar */}
      <div style={{ background: C.ink }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 20px' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={q}
              onChange={e => handleQueryChange(e.target.value)}
              placeholder="Search: laptop repair, branding, catering…"
              autoComplete="off"
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 14, border: 'none',
                fontSize: 15, background: 'rgba(255,255,255,0.12)', color: '#fff',
                outline: 'none',
              }}
            />
            {loading && (
              <div style={{
                padding: '12px 16px', borderRadius: 14,
                background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)',
                fontSize: 15,
              }}>
                ⏳
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category pills */}
      <div style={{ background: C.ink, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{
          maxWidth: 640, margin: '0 auto', padding: '0 16px 16px',
          overflowX: 'auto', display: 'flex', gap: 8,
          WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        }}>
          <button
            onClick={() => handleCatChange('')}
            style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 20,
              fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer',
              background: !cat ? C.teal : 'rgba(255,255,255,0.12)',
              color: !cat ? '#fff' : 'rgba(255,255,255,0.7)',
            }}
          >
            All
          </button>
          {Object.entries(CATEGORIES).map(([id, { label, emoji }]) => (
            <button
              key={id}
              onClick={() => handleCatChange(cat === id ? '' : id)}
              style={{
                flexShrink: 0, padding: '6px 14px', borderRadius: 20,
                fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer',
                background: cat === id ? C.teal : 'rgba(255,255,255,0.12)',
                color: cat === id ? '#fff' : 'rgba(255,255,255,0.7)',
              }}
            >
              {emoji} {label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 40px' }}>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 16, fontWeight: 500 }}>
          {businesses.length === 0
            ? 'No businesses found'
            : `${businesses.length} business${businesses.length > 1 ? 'es' : ''} found`}
          {cat && CATEGORIES[cat] && (
            <span style={{ color: C.teal }}> · {CATEGORIES[cat].label}</span>
          )}
        </div>

        {businesses.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {businesses.map(biz => <BusinessCard key={biz.id} biz={biz} />)}
          </div>
        ) : (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            background: C.surface, borderRadius: 20, border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: C.ink, marginBottom: 6 }}>No businesses found</div>
            <div style={{ fontSize: 14, color: C.inkSoft, lineHeight: 1.5, marginBottom: 20 }}>
              {q ? `Nothing matched "${q}" yet. Try a different search.`
                 : 'No businesses in this category yet. Check back soon!'}
            </div>
            <button
              onClick={() => { setQ(''); handleCatChange(''); }}
              style={{
                padding: '10px 20px', background: C.teal, color: '#fff',
                borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Browse all businesses
            </button>
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 40, padding: '20px 0', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
            Are you a business owner?{' '}
            <a href="/" style={{ color: C.teal, fontWeight: 600, textDecoration: 'none' }}>
              Get your own AI bot on MiniMe →
            </a>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            Also search on Telegram: <strong style={{ color: C.ink }}>@MiniMeSearchBot</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
