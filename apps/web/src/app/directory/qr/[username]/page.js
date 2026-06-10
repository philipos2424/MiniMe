/**
 * /directory/qr/[username] — Printable QR code page for a business listing.
 *
 * Scanning the QR code opens the business profile page.
 * Owners can screenshot this and add it to their storefront, business card,
 * flyers, menus, etc. — customers scan to instantly chat on Telegram.
 */
import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function fetchBusiness(username) {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } },
    );
    const { data } = await sb
      .from('businesses')
      .select('name, telegram_bot_username, category, tagline, logo_url')
      .eq('telegram_bot_username', username)
      .eq('b2b_discoverable', true)
      .maybeSingle();
    return data || null;
  } catch { return null; }
}

export async function generateMetadata({ params }) {
  const biz = await fetchBusiness(params.username);
  if (!biz) return { title: 'QR Code — MiniMe' };
  return { title: `QR Code — ${biz.name}`, robots: 'noindex' };
}

const CATEGORIES = {
  branding_design: '🎨', printing_signage: '🖨️', photography_video: '📸',
  catering_food: '🍽️', food_beverage: '☕', it_tech: '💻',
  events_entertainment: '🎉', clothing_fashion: '👗', beauty_wellness: '💆',
  construction_interior: '🏗️', transport_delivery: '🚚', training_consulting: '📋',
  wholesale_supply: '📦', electronics_phones: '📱',
};

export default async function QRPage({ params }) {
  const biz = await fetchBusiness(params.username);
  if (!biz) notFound();

  const BASE = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim();
  const profileUrl = `${BASE}/directory/${biz.telegram_bot_username}`;
  const chatUrl    = `https://t.me/${biz.telegram_bot_username}?start=minime_qr`;
  // QR code points to the chat link directly (instant chat, no redirect)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=20&data=${encodeURIComponent(chatUrl)}&color=0E2823&bgcolor=FBF8F1`;
  const emoji = CATEGORIES[biz.category] || '🏢';

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FBF8F1',
      fontFamily: "'Geist', 'Inter', -apple-system, system-ui, sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 20px',
    }}>

      {/* Card — designed for screenshot/print */}
      <div style={{
        background: '#fff',
        borderRadius: 28,
        border: '1px solid #E4DED1',
        boxShadow: '0 4px 24px rgba(14,40,35,0.10)',
        padding: '36px 32px',
        maxWidth: 380,
        width: '100%',
        textAlign: 'center',
      }}>
        {/* Logo */}
        {biz.logo_url && (
          <div style={{ marginBottom: 16 }}>
            <img
              src={biz.logo_url}
              alt={biz.name}
              style={{ width: 72, height: 72, borderRadius: 16, objectFit: 'cover', border: '1px solid #E4DED1' }}
            />
          </div>
        )}

        {/* Business name */}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#4FA38A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
          {emoji} MiniMe Business
        </div>
        <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 400, color: '#0E2823', margin: '0 0 6px', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
          {biz.name}
        </h1>
        {biz.tagline && (
          <p style={{ fontSize: 13, color: '#4A5E5A', margin: '0 0 20px', fontStyle: 'italic' }}>
            &ldquo;{biz.tagline}&rdquo;
          </p>
        )}

        {/* QR Code */}
        <div style={{ background: '#FBF8F1', borderRadius: 20, padding: 16, marginBottom: 18, display: 'inline-block' }}>
          <img
            src={qrUrl}
            alt={`QR code for ${biz.name}`}
            width={240}
            height={240}
            style={{ display: 'block', borderRadius: 8 }}
          />
        </div>

        {/* Instructions */}
        <div style={{ fontSize: 15, fontWeight: 600, color: '#0E2823', marginBottom: 4 }}>
          Scan to chat with us on Telegram
        </div>
        <div style={{ fontSize: 12, color: '#8A9590', marginBottom: 20, lineHeight: 1.5 }}>
          Or search <strong style={{ color: '#0E2823' }}>@{biz.telegram_bot_username}</strong> on Telegram
        </div>

        {/* Telegram button */}
        <a href={chatUrl} target="_blank" rel="noopener noreferrer" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: '#0E2823', color: '#fff', borderRadius: 12,
          padding: '13px 20px', textDecoration: 'none', fontSize: 14, fontWeight: 600,
          marginBottom: 12,
        }}>
          💬 Open in Telegram
        </a>

        <a href={profileUrl} style={{
          display: 'block', fontSize: 12, color: '#8A9590', textDecoration: 'none',
        }}>
          View full profile →
        </a>
      </div>

      {/* MiniMe badge */}
      <div style={{ marginTop: 20, fontSize: 12, color: '#8A9590', textAlign: 'center' }}>
        Powered by{' '}
        <a href={`${BASE}/directory`} style={{ color: '#4FA38A', fontWeight: 600, textDecoration: 'none' }}>
          MiniMe Search
        </a>
        {' '}— AI business bots for Ethiopia
      </div>

      {/* Print hint */}
      <div style={{ marginTop: 12, fontSize: 11, color: '#B0ADA8', textAlign: 'center' }}>
        Screenshot this page to use on your storefront, business card, or flyers
      </div>
    </div>
  );
}
