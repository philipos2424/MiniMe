/**
 * /directory — Public business directory.
 *
 * Server-rendered for SEO. Accepts ?q (search) and ?cat (category filter).
 * Anyone can browse — no auth required.
 */
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// ── Category taxonomy ───────────────────────────────────────────────────────
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

// ── Data fetching ────────────────────────────────────────────────────────────
async function fetchBusinesses({ q, cat }) {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    let query = sb
      .from('businesses')
      .select('id, name, description, category, tags, location, address, telegram_bot_username')
      .eq('b2b_discoverable', true)
      .not('telegram_bot_username', 'is', null)
      .order('search_count', { ascending: false, nullsFirst: false })
      .limit(30);

    if (cat && CATEGORIES[cat]) query = query.eq('category', cat);

    const { data, error } = await query;
    if (error) { console.warn('[directory]', error.message); return []; }

    let results = data || [];

    // Client-side keyword filter
    if (q && q.trim()) {
      const kws = q.toLowerCase().trim().split(/\s+/);
      const scored = results.map(b => {
        const haystack = [
          b.name, b.description, b.category,
          CATEGORIES[b.category]?.label,
          ...(Array.isArray(b.tags) ? b.tags : []),
          b.location,
        ].join(' ').toLowerCase();
        const hits = kws.filter(k => haystack.includes(k)).length;
        return { ...b, _score: hits };
      });
      results = scored.filter(b => b._score > 0).sort((a, b) => b._score - a._score);
    }

    return results;
  } catch (e) {
    console.error('[directory] fetch error:', e.message);
    return [];
  }
}

// ── Styles ───────────────────────────────────────────────────────────────────
const C = {
  bg: '#FBF8F1', surface: '#FFFFFF', border: '#E4DED1',
  ink: '#0E2823', inkSoft: '#4A5E5A', muted: '#8A9590',
  teal: '#4FA38A', tealLight: 'rgba(79,163,138,0.10)',
  amber: '#B08A4A',
};

// ── Components ───────────────────────────────────────────────────────────────
function BusinessCard({ biz }) {
  const catInfo = CATEGORIES[biz.category] || { label: biz.category, emoji: '🏢' };
  const tags = Array.isArray(biz.tags) ? biz.tags.slice(0, 4) : [];
  const desc = biz.description ? biz.description.slice(0, 120) + (biz.description.length > 120 ? '…' : '') : null;
  const deepLink = `https://t.me/${biz.telegram_bot_username}?start=minime_search`;

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 20, padding: '20px 22px',
      boxShadow: '0 1px 0 rgba(14,40,35,.04), 0 8px 24px -12px rgba(14,40,35,.10)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
            {biz.name}
          </div>
          <div style={{ fontSize: 12, color: C.teal, fontWeight: 500, marginTop: 2 }}>
            {catInfo.emoji} {catInfo.label}
          </div>
        </div>
        <a
          href={deepLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flexShrink: 0, background: C.teal, color: '#fff',
            fontSize: 13, fontWeight: 600, padding: '8px 14px',
            borderRadius: 12, textDecoration: 'none', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          💬 Chat
        </a>
      </div>

      {/* Description */}
      {desc && (
        <p style={{ fontSize: 14, color: C.inkSoft, margin: '0 0 10px', lineHeight: 1.55 }}>
          {desc}
        </p>
      )}

      {/* Location + Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {biz.location && (
          <span style={{ fontSize: 12, color: C.muted }}>
            📍 {biz.location}
          </span>
        )}
        {tags.map(tag => (
          <span key={tag} style={{
            fontSize: 11, fontWeight: 500, color: C.inkSoft,
            background: C.tealLight, padding: '3px 8px', borderRadius: 6,
          }}>
            {tag}
          </span>
        ))}
      </div>

      {/* Bot link */}
      <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>
        @{biz.telegram_bot_username}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default async function DirectoryPage({ searchParams }) {
  const q   = (searchParams?.q   || '').trim().slice(0, 200);
  const cat = (searchParams?.cat || '').trim();
  const activeCat = CATEGORIES[cat] ? cat : '';

  const businesses = await fetchBusinesses({ q, cat: activeCat });
  const total = businesses.length;

  const title = activeCat
    ? `${CATEGORIES[activeCat].emoji} ${CATEGORIES[activeCat].label}`
    : q ? `Results for "${q}"` : 'All Businesses';

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Geist', 'Inter', -apple-system, system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: C.ink, paddingBottom: 1 }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 20px' }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            MiniMe Search
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 400, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
            Find Ethiopian Businesses
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: '0 0 20px', lineHeight: 1.5 }}>
            Every listing is a live AI bot — tap to chat instantly on Telegram
          </p>

          {/* Search form */}
          <form method="GET" action="/directory" style={{ display: 'flex', gap: 8 }}>
            {activeCat && <input type="hidden" name="cat" value={activeCat} />}
            <input
              name="q"
              defaultValue={q}
              placeholder="Search: laptop repair, branding, catering…"
              autoComplete="off"
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 14, border: 'none',
                fontSize: 15, background: 'rgba(255,255,255,0.12)', color: '#fff',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                padding: '12px 20px', borderRadius: 14, border: 'none',
                background: C.teal, color: '#fff', fontSize: 15,
                fontWeight: 600, cursor: 'pointer', flexShrink: 0,
              }}
            >
              🔍
            </button>
          </form>
        </div>
      </div>

      {/* Category filter pills */}
      <div style={{ background: C.ink, borderBottom: `1px solid rgba(255,255,255,0.08)` }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 16px', overflowX: 'auto', display: 'flex', gap: 8, WebkitOverflowScrolling: 'touch' }}>
          {/* All */}
          <a
            href={q ? `/directory?q=${encodeURIComponent(q)}` : '/directory'}
            style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              textDecoration: 'none', cursor: 'pointer',
              background: !activeCat ? C.teal : 'rgba(255,255,255,0.12)',
              color: !activeCat ? '#fff' : 'rgba(255,255,255,0.7)',
            }}
          >
            All
          </a>
          {Object.entries(CATEGORIES).map(([id, { label, emoji }]) => (
            <a
              key={id}
              href={q ? `/directory?cat=${id}&q=${encodeURIComponent(q)}` : `/directory?cat=${id}`}
              style={{
                flexShrink: 0, padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
                textDecoration: 'none', cursor: 'pointer',
                background: activeCat === id ? C.teal : 'rgba(255,255,255,0.12)',
                color: activeCat === id ? '#fff' : 'rgba(255,255,255,0.7)',
              }}
            >
              {emoji} {label}
            </a>
          ))}
        </div>
      </div>

      {/* Results */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 40px' }}>

        {/* Result count */}
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 16, fontWeight: 500 }}>
          {total === 0
            ? 'No businesses found'
            : `${total} business${total > 1 ? 'es' : ''} ${q || activeCat ? 'found' : 'on MiniMe'}`}
          {activeCat && <span style={{ color: C.teal }}> · {CATEGORIES[activeCat].label}</span>}
        </div>

        {/* Business cards */}
        {total > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {businesses.map(biz => <BusinessCard key={biz.id} biz={biz} />)}
          </div>
        ) : (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            background: C.surface, borderRadius: 20, border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: C.ink, marginBottom: 6 }}>
              No businesses found
            </div>
            <div style={{ fontSize: 14, color: C.inkSoft, lineHeight: 1.5, marginBottom: 20 }}>
              {q ? `Nothing matched "${q}" yet. Try a different search or browse by category.`
                 : 'No businesses in this category yet. Check back soon — MiniMe is growing!'}
            </div>
            <a href="/directory" style={{
              display: 'inline-block', padding: '10px 20px', background: C.teal,
              color: '#fff', borderRadius: 12, textDecoration: 'none', fontSize: 14, fontWeight: 600,
            }}>
              Browse all businesses
            </a>
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
            Or search on Telegram: <strong style={{ color: C.ink }}>@MiniMeSearchBot</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
