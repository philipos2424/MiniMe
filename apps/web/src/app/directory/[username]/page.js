/**
 * /directory/[username] — Individual business profile page.
 *
 * Shareable URL for each business. SEO-friendly with Open Graph tags.
 * E.g. /directory/TechZoneBot → TechZone's listing with a "Chat" button.
 */
import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

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

async function fetchBusiness(username) {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const { data } = await sb
      .from('businesses')
      .select('id, name, description, category, tags, location, address, telegram_bot_username, website, phone')
      .eq('telegram_bot_username', username)
      .eq('b2b_discoverable', true)
      .maybeSingle();
    return data || null;
  } catch { return null; }
}

export async function generateMetadata({ params }) {
  const biz = await fetchBusiness(params.username);
  if (!biz) return { title: 'Business Not Found — MiniMe' };
  return {
    title: `${biz.name} — MiniMe Directory`,
    description: biz.description || `Chat with ${biz.name} on Telegram via MiniMe.`,
    openGraph: {
      title: biz.name,
      description: biz.description || `${biz.name} is on MiniMe — chat instantly on Telegram.`,
      type: 'website',
    },
  };
}

const C = {
  bg: '#FBF8F1', surface: '#FFFFFF', border: '#E4DED1',
  ink: '#0E2823', inkSoft: '#4A5E5A', muted: '#8A9590',
  teal: '#4FA38A', tealLight: 'rgba(79,163,138,0.10)',
};

export default async function BusinessProfilePage({ params }) {
  const biz = await fetchBusiness(params.username);
  if (!biz) notFound();

  const catInfo = CATEGORIES[biz.category] || { label: biz.category || 'Business', emoji: '🏢' };
  const tags = Array.isArray(biz.tags) ? biz.tags : [];
  const deepLink = `https://t.me/${biz.telegram_bot_username}?start=minime_search`;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Geist', 'Inter', -apple-system, system-ui, sans-serif" }}>

      {/* Back nav */}
      <div style={{ background: C.ink, padding: '12px 16px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <a href="/directory" style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            ← MiniMe Search
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px 48px' }}>

        {/* Business header */}
        <div style={{ background: C.surface, borderRadius: 22, border: `1px solid ${C.border}`, padding: '24px 24px 20px', boxShadow: '0 1px 0 rgba(14,40,35,.04), 0 8px 24px -12px rgba(14,40,35,.10)', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            {catInfo.emoji} {catInfo.label}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 400, color: C.ink, margin: '0 0 8px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
            {biz.name}
          </h1>
          {biz.description && (
            <p style={{ fontSize: 15, color: C.inkSoft, margin: '0 0 16px', lineHeight: 1.6 }}>
              {biz.description}
            </p>
          )}

          {/* Location */}
          {biz.location && (
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
              📍 {biz.location}{biz.address ? ` · ${biz.address}` : ''}
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 12, fontWeight: 500, color: C.inkSoft,
                  background: C.tealLight, padding: '4px 10px', borderRadius: 8,
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* CTA — Chat button */}
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '14px 20px', background: C.teal, color: '#fff',
              borderRadius: 14, textDecoration: 'none', fontSize: 16, fontWeight: 600,
              boxSizing: 'border-box',
            }}
          >
            💬 Chat with {biz.name} on Telegram
          </a>
          <div style={{ textAlign: 'center', fontSize: 12, color: C.muted, marginTop: 8 }}>
            @{biz.telegram_bot_username} · Opens in Telegram
          </div>
        </div>

        {/* Contact details (if public) */}
        {(biz.phone || biz.website) && (
          <div style={{ background: C.surface, borderRadius: 18, border: `1px solid ${C.border}`, padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Contact</div>
            {biz.phone && (
              <div style={{ fontSize: 14, color: C.inkSoft, marginBottom: 6 }}>
                📞 <a href={`tel:${biz.phone}`} style={{ color: C.teal, textDecoration: 'none' }}>{biz.phone}</a>
              </div>
            )}
            {biz.website && (
              <div style={{ fontSize: 14, color: C.inkSoft }}>
                🌐 <a href={biz.website} target="_blank" rel="noopener noreferrer" style={{ color: C.teal, textDecoration: 'none' }}>{biz.website.replace(/^https?:\/\//, '')}</a>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
            Powered by{' '}
            <a href="/directory" style={{ color: C.teal, fontWeight: 600, textDecoration: 'none' }}>
              MiniMe Search
            </a>
            {' '}— Find more Ethiopian businesses
          </div>
        </div>
      </div>
    </div>
  );
}
