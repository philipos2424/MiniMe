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
  gold: '#D4A017',
};

function Stars({ rating, reviews }) {
  if (!reviews) return <span style={{ fontSize: 11, color: C.muted }}>New</span>;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ fontSize: 12, color: C.gold, letterSpacing: 0.5 }}>
        {'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}
      </span>
      <span style={{ fontSize: 11, color: C.muted }}>{rating} ({reviews})</span>
    </span>
  );
}

function BusinessCard({ biz }) {
  const catInfo  = CATEGORIES[biz.category] || { label: biz.category || 'Business', emoji: '🏢' };
  const tags     = Array.isArray(biz.tags) ? biz.tags.slice(0, 3) : [];
  const headline = biz.tagline || (biz.description ? biz.description.slice(0, 100) + (biz.description.length > 100 ? '…' : '') : null);
  const chatLink = biz.telegram_bot_username
    ? `https://t.me/${biz.telegram_bot_username}?start=minime_search`
    : `https://t.me/MiniMeAgentBot?start=shop_${biz.shop_code}`;
  const profile = biz.telegram_bot_username ? `/directory/${biz.telegram_bot_username}` : null;
  const photo    = biz.logo_url || biz.first_product_image || null;

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 20,
      overflow: 'hidden',
      boxShadow: '0 1px 0 rgba(14,40,35,.04), 0 6px 20px -8px rgba(14,40,35,.10)',
      transition: 'box-shadow 0.15s ease',
    }}>
      {/* Cover photo */}
      {photo && (
        profile
          ? <a href={profile} style={{ display: 'block', height: 150, overflow: 'hidden', background: C.tealLight }}>
              <img src={photo} alt={biz.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
            </a>
          : <div style={{ display: 'block', height: 150, overflow: 'hidden', background: C.tealLight }}>
              <img src={photo} alt={biz.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
            </div>
      )}

      <div style={{ padding: '14px 16px 16px' }}>
        {/* Category + rating */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.teal, letterSpacing: '0.04em' }}>
            {catInfo.emoji} {catInfo.label}
          </span>
          <Stars rating={biz.average_rating} reviews={biz.total_reviews} />
        </div>

        {/* Name row + CTA */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            {profile
            ? <a href={profile} style={{ textDecoration: 'none' }}>
                <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, lineHeight: 1.25, letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>{biz.name}</div>
              </a>
            : <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, lineHeight: 1.25, letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>{biz.name}</div>
          }
          </div>
          <a
            href={chatLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flexShrink: 0,
              background: C.teal,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 14px',
              borderRadius: 10,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              letterSpacing: '-0.01em',
            }}
          >
            💬 Chat
          </a>
        </div>

        {/* Headline (tagline or description) */}
        {headline && (
          <p style={{ fontSize: 13, color: C.inkSoft, margin: '0 0 10px', lineHeight: 1.5 }}>
            {headline}
          </p>
        )}

        {/* Location + tags */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {biz.location && (
            <span style={{ fontSize: 11, color: C.muted }}>📍 {biz.location}</span>
          )}
          {tags.map(tag => (
            <span key={tag} style={{
              fontSize: 11, fontWeight: 500, color: C.inkSoft,
              background: C.tealLight, padding: '2px 8px', borderRadius: 6,
            }}>
              {tag}
            </span>
          ))}
        </div>

        {/* View profile link */}
        {profile && (
          <a href={profile} style={{ display: 'block', marginTop: 10, fontSize: 11, color: C.muted, textDecoration: 'none', textAlign: 'right' }}>
            View profile →
          </a>
        )}
      </div>
    </div>
  );
}

export default function DirectorySearch({ initialBusinesses = [], initialQ = '', initialCat = '' }) {
  const [q, setQ]                   = useState(initialQ);
  const [cat, setCat]               = useState(initialCat);
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
      const res  = await fetch(`/api/directory/search?${params}`);
      const json = await res.json();
      setBusinesses(json.businesses || []);
      const url = new URL(window.location.href);
      query.trim() ? url.searchParams.set('q', query.trim()) : url.searchParams.delete('q');
      category   ? url.searchParams.set('cat', category)   : url.searchParams.delete('cat');
      window.history.replaceState({}, '', url.toString());
    } catch {}
    setLoading(false);
  }, []);

  const handleQueryChange = (val) => {
    setQ(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val, cat), 350);
  };

  const handleCatChange = (newCat) => {
    setCat(newCat);
    search(q, newCat);
  };

  const totalWithRating = businesses.filter(b => b.total_reviews > 0).length;

  return (
    <div>
      {/* Search bar */}
      <div style={{ background: C.ink }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 20px' }}>
          <div style={{ position: 'relative' }}>
            <input
              value={q}
              onChange={e => handleQueryChange(e.target.value)}
              placeholder="Search: laptop repair, branding, catering…"
              autoComplete="off"
              style={{
                width: '100%', padding: '13px 44px 13px 16px',
                borderRadius: 14, border: 'none',
                fontSize: 15, background: 'rgba(255,255,255,0.12)',
                color: '#fff', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', fontSize: 16, pointerEvents: 'none' }}>
              {loading ? '⏳' : '🔍'}
            </div>
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
              fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: !cat ? C.teal : 'rgba(255,255,255,0.12)',
              color: !cat ? '#fff' : 'rgba(255,255,255,0.7)',
              transition: 'all 0.15s',
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
                fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: cat === id ? C.teal : 'rgba(255,255,255,0.12)',
                color: cat === id ? '#fff' : 'rgba(255,255,255,0.7)',
                transition: 'all 0.15s',
              }}
            >
              {emoji} {label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 48px' }}>

        {/* Results count + filter hint */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 6 }}>
          <div style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>
            {businesses.length === 0
              ? 'No businesses found'
              : `${businesses.length} business${businesses.length > 1 ? 'es' : ''}`}
            {cat && CATEGORIES[cat] && (
              <span style={{ color: C.teal }}> · {CATEGORIES[cat].emoji} {CATEGORIES[cat].label}</span>
            )}
          </div>
          {totalWithRating > 0 && (
            <span style={{ fontSize: 11, color: C.muted }}>
              ⭐ {totalWithRating} rated
            </span>
          )}
        </div>

        {businesses.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {businesses.map(biz => <BusinessCard key={biz.id} biz={biz} />)}
          </div>
        ) : (
          <div style={{
            textAlign: 'center', padding: '48px 20px',
            background: C.surface, borderRadius: 20, border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>🔍</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, marginBottom: 8, fontFamily: "'Fraunces', Georgia, serif" }}>
              Nothing found{q ? ` for "${q}"` : ''}
            </div>
            <div style={{ fontSize: 14, color: C.inkSoft, lineHeight: 1.6, marginBottom: 22, maxWidth: 300, margin: '0 auto 22px' }}>
              {q ? 'Try a different search term or browse a category below.'
                 : 'No businesses in this category yet — check back soon!'}
            </div>
            <button
              onClick={() => { setQ(''); handleCatChange(''); }}
              style={{
                padding: '11px 22px', background: C.teal, color: '#fff',
                borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Browse all businesses
            </button>
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 48, padding: '20px 0', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7 }}>
            Are you a business owner?{' '}
            <a href="/" style={{ color: C.teal, fontWeight: 600, textDecoration: 'none' }}>
              Get your AI bot on MiniMe →
            </a>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            Also search on Telegram:{' '}
            <a href="https://t.me/MiniMeSearchBot" style={{ color: C.ink, fontWeight: 600, textDecoration: 'none' }}>
              @MiniMeSearchBot
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
