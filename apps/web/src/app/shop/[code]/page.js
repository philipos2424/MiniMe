/**
 * /shop/[code] — Public, branded storefront landing page for a business.
 *
 * WHY THIS EXISTS: shared-mode owners (the "Recommended" onboarding path) get a
 * customer link of the form `t.me/MiniMeAgentBot?start=shop_XXX`. When they paste
 * that into Instagram bio / WhatsApp status / Facebook, Telegram's link preview
 * pulls @MiniMeAgentBot's avatar + name + bio — so the owner's store shows up
 * branded as "MiniMe", not as THEIR business. (The "it shares my store as MiniMe"
 * complaint.) Telegram allows only ONE identity per bot, so we can't fix the
 * t.me preview directly.
 *
 * The fix: owners share THIS page's URL instead. It's a normal web page we fully
 * control, so its Open Graph tags (title/description/image) render the owner's
 * own business in every link preview. A prominent "Chat on Telegram" button then
 * forwards the customer into the real bot via the deep link. Custom-bot tenants
 * get the same branded page, just pointing at their own @YourShopBot.
 *
 * No auth: the shop_code is the public access token (same model as /receipt/[id]).
 */
import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const SHARED_BOT = 'MiniMeAgentBot';

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

function baseUrl() {
  return (process.env.WEB_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app')
    .trim().replace(/\/$/, '');
}

/** The actual Telegram deep link a customer is forwarded into. Custom-bot
 *  tenants go to their own @bot; shared-mode tenants go to @MiniMeAgentBot with
 *  the shop_ start-param so the webhook routes them to this business. */
function chatLink(biz) {
  if (biz.telegram_bot_username) {
    return `https://t.me/${biz.telegram_bot_username}?start=shop`;
  }
  return `https://t.me/${SHARED_BOT}?start=shop_${biz.shop_code}`;
}

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

async function fetchShop(code) {
  if (!code) return null;
  try {
    const { data } = await sb()
      .from('businesses')
      .select('id, name, description, tagline, category, location, address, logo_url, average_rating, total_reviews, telegram_bot_username, shop_code, onboarding_completed, currency')
      .eq('shop_code', code)
      .maybeSingle();
    if (!data) return null;
    return data;
  } catch (e) {
    console.warn('[shop] fetch error:', e.message);
    return null;
  }
}

async function fetchTopProducts(businessId) {
  try {
    const { data } = await sb()
      .from('products')
      .select('name, price, currency')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(6);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }) {
  const biz = await fetchShop(params.code);
  if (!biz) {
    return { title: 'Shop not found — MiniMe' };
  }
  const cat = CATEGORIES[biz.category];
  const title = biz.name;
  const description =
    (biz.tagline || biz.description || `Chat with ${biz.name} on Telegram — quick answers, prices, and orders.`)
      .toString().slice(0, 200);
  const url = `${baseUrl()}/shop/${biz.shop_code}`;
  const images = biz.logo_url ? [{ url: biz.logo_url }] : undefined;

  return {
    title: `${title}${cat ? ` · ${cat.label}` : ''}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: title,            // show the BUSINESS as the site, not MiniMe
      type: 'website',
      images,
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title,
      description,
      images: biz.logo_url ? [biz.logo_url] : undefined,
    },
  };
}

function fmtPrice(p, cur) {
  if (p == null) return '';
  return `${Number(p).toLocaleString()} ${cur || 'ETB'}`;
}

export default async function ShopPage({ params }) {
  const biz = await fetchShop(params.code);
  if (!biz) notFound();

  const products = await fetchTopProducts(biz.id);
  const cat = CATEGORIES[biz.category];
  const link = chatLink(biz);
  const rating = Number(biz.average_rating) || 0;
  const reviews = Number(biz.total_reviews) || 0;
  const initial = (biz.name || '?').trim().charAt(0).toUpperCase();
  const tagline = biz.tagline || biz.description || '';
  const place = biz.location || biz.address || '';

  return (
    <div className="shop-wrap">
        {/* Scoped storefront CSS. Rendered in-body (valid HTML) so this page
            doesn't need its own <html>/<head> — the OG/meta tags come from
            generateMetadata via the root layout, which is what link-preview
            crawlers read. */}
        <style>{`
          .shop-wrap {
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 24px 12px 40px;
            color: #0E2823;
            background: #FBF8F1;
          }
          .shop-wrap * { box-sizing: border-box; }
          .card {
            background: #fff;
            width: 100%;
            max-width: 440px;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 8px 40px rgba(14,40,35,0.10);
          }
          .header {
            background: #0E2823;
            color: #fff;
            padding: 36px 24px 28px;
            text-align: center;
          }
          .logo {
            width: 84px; height: 84px;
            border-radius: 50%;
            margin: 0 auto 16px;
            object-fit: cover;
            border: 3px solid rgba(255,255,255,0.15);
            background: rgba(255,255,255,0.08);
            display: grid; place-items: center;
            font-size: 36px; font-weight: 700;
            font-family: 'Fraunces', Georgia, serif;
            color: #fff;
            overflow: hidden;
          }
          .biz-name {
            font-size: 26px; font-weight: 400; letter-spacing: -0.02em;
            font-family: 'Fraunces', Georgia, serif;
          }
          .biz-cat {
            display: inline-block; margin-top: 12px;
            font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
            color: rgba(255,255,255,0.6);
            background: rgba(255,255,255,0.08);
            padding: 5px 12px; border-radius: 999px;
          }
          .rating {
            margin-top: 12px; font-size: 13px; color: #E9C46A;
          }
          .body { padding: 24px; }
          .tagline {
            font-size: 15px; line-height: 1.55; color: #3a514c;
            text-align: center; margin-bottom: 4px;
          }
          .place {
            text-align: center; font-size: 13px; color: #8a9590; margin-top: 10px;
          }
          .cta {
            display: flex; align-items: center; justify-content: center; gap: 9px;
            width: 100%; margin-top: 24px;
            background: #229ED9; color: #fff; text-decoration: none;
            padding: 16px; border-radius: 14px;
            font-size: 16px; font-weight: 600;
            box-shadow: 0 4px 16px rgba(34,158,217,0.30);
          }
          .cta svg { width: 20px; height: 20px; }
          .hint {
            text-align: center; font-size: 12px; color: #8a9590; margin-top: 10px;
          }
          .section-title {
            font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
            text-transform: uppercase; color: #8a9590; margin: 28px 0 12px;
          }
          .item-row {
            display: flex; justify-content: space-between; align-items: baseline;
            gap: 12px; padding: 11px 0; border-bottom: 1px solid #f0ede7;
            font-size: 14px;
          }
          .item-row:last-child { border-bottom: none; }
          .item-name { flex: 1; font-weight: 500; color: #1a2e2a; }
          .item-price { font-weight: 700; white-space: nowrap; color: #0E2823; }
          .footer {
            background: #FBF8F1; padding: 18px 24px; text-align: center;
            border-top: 1px solid #E4DED1;
          }
          .powered { font-size: 11px; color: #b0a898; }
          .powered a { color: #b0a898; text-decoration: none; }
        `}</style>
        <div className="card">
          <div className="header">
            {biz.logo_url
              ? <img className="logo" src={biz.logo_url} alt={biz.name} />
              : <div className="logo">{initial}</div>}
            <div className="biz-name">{biz.name}</div>
            {cat && <div className="biz-cat">{cat.emoji} {cat.label}</div>}
            {rating > 0 && (
              <div className="rating">
                {'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}
                {reviews > 0 ? ` · ${reviews} review${reviews === 1 ? '' : 's'}` : ''}
              </div>
            )}
          </div>

          <div className="body">
            {tagline && <p className="tagline">{tagline}</p>}
            {place && <div className="place">📍 {place}</div>}

            <a className="cta" href={link}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.05-1.99 1.93c-.23.23-.42.42-.83.42z"/>
              </svg>
              Chat on Telegram
            </a>
            <div className="hint">Tap to message us instantly — no app sign-up needed.</div>

            {products.length > 0 && (
              <>
                <div className="section-title">What we offer</div>
                {products.map((p, i) => (
                  <div key={i} className="item-row">
                    <span className="item-name">{p.name}</span>
                    {p.price != null && (
                      <span className="item-price">{fmtPrice(p.price, p.currency || biz.currency)}</span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="footer">
            <div className="powered">
              Powered by <a href={baseUrl()}>MiniMe</a> · AI assistant on Telegram
            </div>
          </div>
        </div>
    </div>
  );
}
