'use client';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

export default function BusinessCardPage() {
  const { business } = useTelegram() || {};
  if (!business) return null;

  // Shared mode → branded /shop page (previews as the owner's business, not
  // MiniMe) since this card link is meant to be pasted on other platforms.
  const _webBase = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');
  const botLink = business.telegram_bot_username
    ? `https://t.me/${business.telegram_bot_username}`
    : business.shop_code
      ? `${_webBase}/shop/${business.shop_code}`
      : null;

  const plain = [
    business.name,
    business.category ? `[${business.category}]` : null,
    business.description ? `\n${business.description.slice(0, 120)}` : null,
    ``,
    business.owner_phone ? `Phone: ${business.owner_phone}` : null,
    business.address     ? `Location: ${business.address}` : null,
    business.business_hours ? `Hours: ${business.business_hours}` : null,
    business.instagram   ? `Instagram: ${business.instagram}` : null,
    botLink              ? `\nOrder on Telegram: ${botLink}` : null,
  ].filter(Boolean).join('\n');

  const telegram = [
    `🏪 *${business.name}*`,
    business.category ? `_${business.category}_` : null,
    business.description ? `\n${business.description.slice(0, 120)}` : null,
    ``,
    business.owner_phone ? `📱 ${business.owner_phone}` : null,
    business.address     ? `📍 ${business.address}` : null,
    business.business_hours ? `⏰ ${business.business_hours}` : null,
    business.instagram   ? `📸 ${business.instagram}` : null,
    botLink              ? `\n🤖 Order: ${botLink}` : null,
  ].filter(Boolean).join('\n');

  function share() {
    if (navigator.share) navigator.share({ title: business.name, text: plain });
    else navigator.clipboard?.writeText(plain).then(() => tgAlert('Copied!'));
  }

  return (
    <div style={{ fontFamily: FONT.body, color: COLORS.textPrimary, maxWidth: 520, paddingBottom: 100 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#B08A4A', marginBottom: 6 }}>Business Card</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: '0 0 6px', letterSpacing: '-0.02em' }}>Your digital card</h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>Share with customers on WhatsApp, Telegram groups, or Instagram.</p>
      </div>

      {/* Preview card */}
      <div style={{
        background: 'linear-gradient(135deg, #0E2823 0%, #1A3C35 100%)',
        borderRadius: 20, padding: '28px 24px',
        boxShadow: '0 16px 48px -12px rgba(14,40,35,.5)', marginBottom: 20,
      }}>
        <div style={{ fontFamily: SERIF, fontSize: 28, color: '#F4EEE1', letterSpacing: '-0.02em', marginBottom: 4 }}>{business.name}</div>
        {business.category && <div style={{ fontSize: 13, color: '#D4B987', marginBottom: 14, fontStyle: 'italic' }}>{business.category}</div>}
        {business.description && <div style={{ fontSize: 13, color: 'rgba(244,238,225,0.65)', lineHeight: 1.5, marginBottom: 16 }}>{business.description.slice(0, 100)}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {business.owner_phone && <div style={{ fontSize: 13, color: 'rgba(244,238,225,0.75)' }}>📱 {business.owner_phone}</div>}
          {business.address     && <div style={{ fontSize: 13, color: 'rgba(244,238,225,0.75)' }}>📍 {business.address}</div>}
          {business.business_hours && <div style={{ fontSize: 13, color: 'rgba(244,238,225,0.75)' }}>⏰ {business.business_hours}</div>}
          {business.instagram   && <div style={{ fontSize: 13, color: 'rgba(244,238,225,0.75)' }}>📸 {business.instagram}</div>}
          {botLink && <div style={{ marginTop: 8, fontSize: 12, color: '#D4B987', fontWeight: 600 }}>🤖 {botLink.replace('https://', '')}</div>}
        </div>
      </div>

      {/* Missing info */}
      {(!business.owner_phone || !business.address) && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: COLORS.textSecondary }}>
          💡 Add missing info in{' '}<a href="/settings/profile" style={{ color: COLORS.teal, fontWeight: 600, textDecoration: 'none' }}>Business Profile</a> to complete your card.
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button onClick={share} style={{ background: COLORS.textPrimary, color: '#fff', border: 'none', borderRadius: RADII.lg, padding: '14px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body }}>
          📤 Share business card
        </button>
        <button onClick={() => navigator.clipboard?.writeText(telegram).then(() => tgAlert('Copied for Telegram!'))} style={{ background: 'transparent', color: COLORS.textPrimary, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '12px', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: FONT.body }}>
          📋 Copy with Telegram formatting
        </button>
        {botLink && (
          <button onClick={() => { const twa = window.Telegram?.WebApp; if (twa) twa.openLink(`https://t.me/share/url?url=${encodeURIComponent(botLink)}&text=${encodeURIComponent('Order from ' + business.name + ' on Telegram!')}`); }} style={{ background: '#229ED9', color: '#fff', border: 'none', borderRadius: RADII.lg, padding: '12px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body }}>
            ✈️ Share bot link via Telegram
          </button>
        )}
      </div>
    </div>
  );
}
