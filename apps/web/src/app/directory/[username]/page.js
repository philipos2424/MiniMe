/**
 * /directory/[username] — Individual business profile page.
 *
 * Shareable URL for each business. SEO-friendly with Open Graph tags.
 * Shows: logo, name, tagline, description, tags, location, ratings,
 *        top products, recent reviews, and a prominent Chat CTA.
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

async function fetchData(username) {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const [{ data: biz }, { data: products }, { data: reviews }] = await Promise.all([
      sb.from('businesses')
        .select('id, name, description, tagline, category, tags, location, address, telegram_bot_username, website, phone, logo_url, average_rating, total_reviews')
        .eq('telegram_bot_username', username)
        .eq('b2b_discoverable', true)
        .maybeSingle(),
      sb.from('products')
        .select('id, name, name_am, description, price, currency, image_url')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(8),
      sb.from('reviews')
        .select('rating, comment, created_at')
        .eq('visible', true)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    if (!biz) return null;

    // Filter products to this business
    const { data: bizProducts } = await sb.from('products')
      .select('id, name, name_am, description, price, currency, image_url')
      .eq('business_id', biz.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(8);

    const { data: bizReviews } = await sb.from('reviews')
      .select('rating, comment, created_at')
      .eq('business_id', biz.id)
      .eq('visible', true)
      .order('created_at', { ascending: false })
      .limit(5);

    return { biz, products: bizProducts || [], reviews: bizReviews || [] };
  } catch { return null; }
}

export async function generateMetadata({ params }) {
  const result = await fetchData(params.username);
  if (!result?.biz) return { title: 'Business Not Found — MiniMe' };
  const { biz } = result;
  return {
    title: `${biz.name} — MiniMe Directory`,
    description: biz.tagline || biz.description || `Chat with ${biz.name} on Telegram via MiniMe.`,
    openGraph: {
      title: biz.name,
      description: biz.tagline || biz.description || `${biz.name} is on MiniMe — chat instantly on Telegram.`,
      images: biz.logo_url ? [{ url: biz.logo_url }] : [],
      type: 'website',
    },
  };
}

const C = {
  bg: '#FBF8F1', surface: '#FFFFFF', border: '#E4DED1',
  ink: '#0E2823', inkSoft: '#4A5E5A', muted: '#8A9590',
  teal: '#4FA38A', tealLight: 'rgba(79,163,138,0.10)',
  gold: '#D4A017', goldLight: 'rgba(212,160,23,0.10)',
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function StarRow({ rating, size = 16 }) {
  return (
    <span style={{ fontSize: size, letterSpacing: 1 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < rating ? C.gold : '#DDD' }}>★</span>
      ))}
    </span>
  );
}

export default async function BusinessProfilePage({ params }) {
  const result = await fetchData(params.username);
  if (!result) notFound();
  const { biz, products, reviews } = result;

  const catInfo = CATEGORIES[biz.category] || { label: biz.category || 'Business', emoji: '🏢' };
  const tags = Array.isArray(biz.tags) ? biz.tags : [];
  const deepLink = `https://t.me/${biz.telegram_bot_username}?start=minime_search`;
  const hasRating = biz.total_reviews > 0;
  const hasProducts = products.length > 0;
  const hasReviews = reviews.length > 0;
  const productsWithPhoto = products.filter(p => p.image_url);
  const productsTextOnly = products.filter(p => !p.image_url);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Geist', 'Inter', -apple-system, system-ui, sans-serif" }}>

      {/* Back nav */}
      <div style={{ background: C.ink, padding: '12px 16px' }}>
        <div style={{ maxWidth: 580, margin: '0 auto' }}>
          <a href="/directory" style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>
            ← MiniMe Search
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 580, margin: '0 auto', padding: '20px 16px 60px' }}>

        {/* ── Business card ─────────────────────────────────────────────── */}
        <div style={{ background: C.surface, borderRadius: 22, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 1px 0 rgba(14,40,35,.04), 0 8px 32px -12px rgba(14,40,35,.12)', marginBottom: 14 }}>

          {/* Cover photo */}
          {biz.logo_url && (
            <div style={{ height: 200, overflow: 'hidden', background: C.tealLight }}>
              <img src={biz.logo_url} alt={biz.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}

          <div style={{ padding: '22px 22px 20px' }}>
            {/* Category + rating row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {catInfo.emoji} {catInfo.label}
              </span>
              {hasRating ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <StarRow rating={Math.round(biz.average_rating)} size={14} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.gold }}>
                    {biz.average_rating} <span style={{ color: C.muted, fontWeight: 400 }}>({biz.total_reviews} review{biz.total_reviews > 1 ? 's' : ''})</span>
                  </span>
                </span>
              ) : (
                <span style={{ fontSize: 12, color: C.muted }}>⭐ New on MiniMe</span>
              )}
            </div>

            {/* Name */}
            <h1 style={{ fontSize: 26, fontWeight: 400, color: C.ink, margin: '0 0 6px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.2 }}>
              {biz.name}
            </h1>

            {/* Tagline */}
            {biz.tagline && (
              <p style={{ fontSize: 15, color: C.teal, fontWeight: 500, margin: '0 0 12px', fontStyle: 'italic' }}>
                &ldquo;{biz.tagline}&rdquo;
              </p>
            )}

            {/* Description */}
            {biz.description && (
              <p style={{ fontSize: 15, color: C.inkSoft, margin: '0 0 16px', lineHeight: 1.65 }}>
                {biz.description}
              </p>
            )}

            {/* Location */}
            {biz.location && (
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 5 }}>
                📍 {biz.location}{biz.address ? ` · ${biz.address}` : ''}
              </div>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
                {tags.map(tag => (
                  <span key={tag} style={{ fontSize: 12, fontWeight: 500, color: C.inkSoft, background: C.tealLight, padding: '4px 10px', borderRadius: 8 }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* CTA */}
            <a href={deepLink} target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '15px 20px', background: C.teal, color: '#fff',
              borderRadius: 14, textDecoration: 'none', fontSize: 16, fontWeight: 600,
              boxSizing: 'border-box', letterSpacing: '-0.01em',
            }}>
              💬 Chat with {biz.name} on Telegram
            </a>
            <div style={{ textAlign: 'center', fontSize: 12, color: C.muted, marginTop: 8 }}>
              @{biz.telegram_bot_username} · Opens in Telegram instantly
            </div>
          </div>
        </div>

        {/* ── Products ───────────────────────────────────────────────────── */}
        {hasProducts && (
          <div style={{ background: C.surface, borderRadius: 18, border: `1px solid ${C.border}`, padding: '16px 20px', marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
              Products & Services
            </div>

            {/* Photo products — horizontal scroll */}
            {productsWithPhoto.length > 0 && (
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', marginBottom: productsTextOnly.length > 0 ? 14 : 0, paddingBottom: 4, WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
                {productsWithPhoto.map(p => (
                  <div key={p.id} style={{ flexShrink: 0, width: 140, borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                    <div style={{ height: 110, overflow: 'hidden', background: C.tealLight }}>
                      <img src={p.image_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, lineHeight: 1.3, marginBottom: 3 }}>
                        {p.name}
                      </div>
                      {p.price && (
                        <div style={{ fontSize: 12, color: C.teal, fontWeight: 600 }}>
                          {Number(p.price).toLocaleString()} {p.currency || 'ETB'}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Text-only products */}
            {productsTextOnly.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderTop: i === 0 && productsWithPhoto.length > 0 ? `1px solid ${C.border}` : i > 0 ? `1px solid ${C.border}` : 'none' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: C.ink }}>
                    {p.name}{p.name_am ? ` / ${p.name_am}` : ''}
                  </div>
                  {p.description && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>
                      {p.description.slice(0, 60)}{p.description.length > 60 ? '…' : ''}
                    </div>
                  )}
                </div>
                {p.price && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.teal, marginLeft: 12, flexShrink: 0 }}>
                    {Number(p.price).toLocaleString()} {p.currency || 'ETB'}
                  </div>
                )}
              </div>
            ))}

            <a href={deepLink} target="_blank" rel="noopener noreferrer" style={{
              display: 'block', textAlign: 'center', marginTop: 14, padding: '10px',
              background: C.tealLight, borderRadius: 10, color: C.teal, textDecoration: 'none',
              fontSize: 13, fontWeight: 600,
            }}>
              See full catalog &amp; order →
            </a>
          </div>
        )}

        {/* ── Reviews ────────────────────────────────────────────────────── */}
        {hasReviews && (
          <div style={{ background: C.surface, borderRadius: 18, border: `1px solid ${C.border}`, padding: '16px 20px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Customer Reviews
              </div>
              {hasRating && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StarRow rating={Math.round(biz.average_rating)} size={15} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.gold }}>{biz.average_rating}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>/ 5</span>
                </div>
              )}
            </div>

            {reviews.map((r, i) => (
              <div key={i} style={{ padding: '12px 0', borderTop: i > 0 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <StarRow rating={r.rating} size={15} />
                  <span style={{ fontSize: 11, color: C.muted }}>{timeAgo(r.created_at)}</span>
                </div>
                {r.comment && (
                  <p style={{ fontSize: 14, color: C.inkSoft, margin: 0, lineHeight: 1.55, fontStyle: 'italic' }}>
                    &ldquo;{r.comment}&rdquo;
                  </p>
                )}
              </div>
            ))}

            <div style={{ marginTop: 14, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
              Reviews collected from customers who found this business through MiniMe Search.
            </div>
          </div>
        )}

        {/* ── Contact ────────────────────────────────────────────────────── */}
        {(biz.phone || biz.website) && (
          <div style={{ background: C.surface, borderRadius: 18, border: `1px solid ${C.border}`, padding: '16px 20px', marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Contact</div>
            {biz.phone && (
              <div style={{ fontSize: 14, color: C.inkSoft, marginBottom: 8 }}>
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

        {/* ── Bottom CTA ─────────────────────────────────────────────────── */}
        <a href={deepLink} target="_blank" rel="noopener noreferrer" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', padding: '15px 20px', background: C.ink, color: '#fff',
          borderRadius: 14, textDecoration: 'none', fontSize: 15, fontWeight: 600,
          boxSizing: 'border-box', marginBottom: 24,
        }}>
          💬 Start chatting — it&apos;s instant
        </a>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '4px 0 20px' }}>
          <a href="/directory" style={{ fontSize: 13, color: C.teal, fontWeight: 600, textDecoration: 'none' }}>
            ← Find more Ethiopian businesses on MiniMe
          </a>
        </div>
      </div>
    </div>
  );
}
