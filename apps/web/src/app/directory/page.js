/**
 * /directory — Public business directory.
 *
 * Server component: renders header + initial businesses (SSR for SEO).
 * DirectorySearch (client) handles real-time search/filter without page reloads.
 */
import { createClient } from '@supabase/supabase-js';
import DirectorySearch from './DirectorySearch';
import SearchCount from '../../components/SearchCount';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }) {
  const q   = (searchParams?.q   || '').trim();
  const cat = (searchParams?.cat || '').trim();
  const catInfo = CATEGORIES[cat];
  if (catInfo) {
    return {
      title: `${catInfo.label} Businesses in Ethiopia — MiniMe Search`,
      description: `Find ${catInfo.label} businesses in Ethiopia on MiniMe. Chat with their AI-powered bots instantly on Telegram.`,
    };
  }
  if (q) {
    return {
      title: `"${q}" — MiniMe Search`,
      description: `Search results for "${q}" on MiniMe — Ethiopian business directory.`,
    };
  }
  return {};
}

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

async function fetchBusinesses({ q, cat }) {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } },
    );
    let query = sb
      .from('businesses')
      .select('id, name, description, tagline, category, tags, location, address, telegram_bot_username, shop_code, logo_url, average_rating, total_reviews')
      .eq('b2b_discoverable', true)
      .or('telegram_bot_username.not.is.null,and(shop_code.not.is.null,onboarding_completed.eq.true)')
      .order('average_rating', { ascending: false, nullsFirst: false })
      .order('search_count', { ascending: false, nullsFirst: false })
      .limit(50);

    if (cat && CATEGORIES[cat]) query = query.eq('category', cat);

    const { data, error } = await query;
    if (error) { console.warn('[directory]', error.message); return []; }

    let results = data || [];
    if (q) {
      const kws = q.toLowerCase().trim().split(/\s+/);
      const scored = results.map(b => {
        const hay = [b.name, b.description, b.category,
          CATEGORIES[b.category]?.label,
          ...(Array.isArray(b.tags) ? b.tags : []), b.location]
          .join(' ').toLowerCase();
        return { ...b, _score: kws.filter(k => hay.includes(k)).length };
      });
      results = scored.filter(b => b._score > 0).sort((a, b) => b._score - a._score);
    }
    return results.map(({ _score, ...b }) => b);
  } catch (e) {
    console.error('[directory] fetch error:', e.message);
    return [];
  }
}

const C = { bg: '#FFFFFF', ink: '#0E2823' };

export default async function DirectoryPage({ searchParams }) {
  const q      = (searchParams?.q   || '').trim().slice(0, 200);
  const cat    = (searchParams?.cat || '').trim();
  const validCat = CATEGORIES[cat] ? cat : '';

  const businesses = await fetchBusinesses({ q, cat: validCat });

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Geist', 'Inter', -apple-system, system-ui, sans-serif" }}>

      {/* Hero header — server-rendered */}
      <div style={{ background: C.ink }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 20px' }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            MiniMe Search
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 400, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
            Find Ethiopian Businesses
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Every listing is a live AI bot — tap to chat instantly on Telegram
          </p>
          <SearchCount tone="dark" style={{ marginBottom: 16 }} />
          {/* Placeholder for client search bar — rendered below in DirectorySearch */}
          <div style={{ height: 48 }} />
        </div>
      </div>

      {/* Interactive client component — hydrates on top of SSR content */}
      <DirectorySearch
        initialBusinesses={businesses}
        initialQ={q}
        initialCat={validCat}
      />
    </div>
  );
}
