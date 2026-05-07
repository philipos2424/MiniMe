'use client';
/**
 * Settings page — redesigned with design tokens (warm-white v2).
 * Category field is now a proper select matching the onboarding categories.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import Link from 'next/link';
import {
  Mic, Shield, CreditCard, ChevronRight,
  Bot, Moon, Banknote, Mail, Save, Bell, LayoutDashboard,
} from 'lucide-react';
import { useToast } from '../ui/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

// Platform admin IDs — same list as server/admin.js fallback
const ADMIN_IDS = [420769631, 669754127];

const CATEGORIES = [
  { id: '',           label: 'Select category…' },
  { id: 'electronics',label: '📱 Electronics & Tech' },
  { id: 'clothing',   label: '👗 Clothing & Fashion' },
  { id: 'food',       label: '🍽 Food & Restaurant' },
  { id: 'beauty',     label: '💅 Beauty & Wellness' },
  { id: 'onlineshop', label: '🛒 Online Shop' },
  { id: 'services',   label: '🔧 Professional Services' },
  { id: 'homegifts',  label: '🏠 Home & Gifts' },
  { id: 'other',      label: '🏢 Other Business' },
];

const LINKS = [
  ['Website',          'website',          'https://yourshop.com'],
  ['Portfolio URL',    'portfolio_url',     'https://yourshop.com/portfolio'],
  ['Instagram',        'instagram',         '@yourhandle  (or full URL)'],
  ['Facebook',         'facebook',          'yourpage  (or full URL)'],
  ['TikTok',           'tiktok',            '@yourhandle'],
  ['Telegram channel', 'telegram_channel',  '@yourchannel'],
  ['WhatsApp',         'whatsapp',          '+251 911 …'],
  ['Address',          'address',           'Bole, Addis Ababa, near …'],
  ['Business hours',   'business_hours',    'Mon–Sat 9am–7pm'],
];

const NAV_SECTIONS = [
  { href: '/settings/bot',           icon: Bot,        label: 'Your Bot',          desc: 'Connect your Telegram bot' },
  { href: '/settings/notifications', icon: Bell,       label: 'Morning Summary',   desc: 'Daily recap from MiniMe in Telegram' },
  { href: '/settings/payments',      icon: Banknote,   label: 'Payments',          desc: 'Chapa, Telegram Stars, CBE transfer' },
  { href: '/settings/hours',         icon: Moon,       label: 'Quiet Hours',       desc: 'When MiniMe slows down or stops' },
  { href: '/settings/voice',         icon: Mic,        label: 'Voice & Style',     desc: 'Train MiniMe to sound like you' },
  { href: '/settings/trust',         icon: Shield,     label: 'Trust Controls',    desc: 'Manage AI autonomy levels' },
  { href: '/settings/billing',       icon: CreditCard, label: 'Billing',           desc: 'Subscription and payments' },
  { href: '/settings/email',         icon: Mail,       label: 'Email Integration', desc: 'Connect Gmail or Outlook', badge: 'Soon' },
];

export default function SettingsPage() {
  const { business: tgBusiness, telegramUser } = useTelegram();
  const isAdmin = ADMIN_IDS.includes(Number(telegramUser?.id));
  const supabase = createClient();
  const { toast } = useToast();
  const { showAmharic, setShowAmharic } = useLanguage();
  const [business, setBusiness] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tgBusiness) setBusiness(tgBusiness);
  }, [tgBusiness]);

  async function save() {
    if (!business) return;
    setSaving(true);
    const { error } = await supabase
      .from('businesses')
      .update({
        name: business.name,
        category: business.category || null,
        location: business.location,
        owner_name: business.owner_name,
        website: business.website || null,
        portfolio_url: business.portfolio_url || null,
        instagram: business.instagram || null,
        facebook: business.facebook || null,
        tiktok: business.tiktok || null,
        telegram_channel: business.telegram_channel || null,
        whatsapp: business.whatsapp || null,
        address: business.address || null,
        business_hours: business.business_hours || null,
      })
      .eq('id', business.id);
    setSaving(false);
    if (error) toast('Could not save changes.', { variant: 'error' });
    else toast('Profile updated.', { variant: 'success' });
  }

  const input = {
    width: '100%',
    border: `1px solid ${COLORS.border}`,
    borderRadius: RADII.sm,
    padding: '11px 14px',
    fontSize: 14,
    fontFamily: FONT.body,
    color: COLORS.textPrimary,
    background: COLORS.bg,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* Sticky header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Settings</h1>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '2px 0 0' }}>
          Tune how MiniMe works for your business
        </p>
      </div>

      <div style={{ padding: '16px 20px' }}>

        {/* Language toggle */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>Show Amharic labels</div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>Adds ፊደል next to English throughout the app.</div>
          </div>
          <button
            onClick={() => setShowAmharic(!showAmharic)}
            role="switch"
            aria-checked={showAmharic}
            style={{
              appearance: 'none', border: 'none', cursor: 'pointer',
              width: 48, height: 28, borderRadius: 999, flexShrink: 0, position: 'relative',
              background: showAmharic ? COLORS.teal : COLORS.border,
              transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 3, width: 22, height: 22, borderRadius: '50%',
              background: '#FFFFFF', transition: 'left 0.2s',
              left: showAmharic ? 23 : 3,
              boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>

        {/* Business profile */}
        {business && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px', boxShadow: SHADOW.card, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 14 }}>BUSINESS PROFILE</div>

            <FieldRow label="Business name">
              <input
                value={business.name || ''} placeholder="e.g. Hana Electronics"
                onChange={e => setBusiness(p => ({ ...p, name: e.target.value }))}
                style={input}
                onFocus={e => e.currentTarget.style.borderColor = COLORS.teal}
                onBlur={e => e.currentTarget.style.borderColor = COLORS.border}
              />
            </FieldRow>

            <FieldRow label="Business category">
              <select
                value={business.category || ''}
                onChange={e => setBusiness(p => ({ ...p, category: e.target.value }))}
                style={{ ...input, color: business.category ? COLORS.textPrimary : COLORS.textHint }}
              >
                {CATEGORIES.map(c => (
                  <option key={c.id} value={c.id} disabled={c.id === ''}>{c.label}</option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Location">
              <input
                value={business.location || ''} placeholder="Addis Ababa"
                onChange={e => setBusiness(p => ({ ...p, location: e.target.value }))}
                style={input}
                onFocus={e => e.currentTarget.style.borderColor = COLORS.teal}
                onBlur={e => e.currentTarget.style.borderColor = COLORS.border}
              />
            </FieldRow>

            <FieldRow label="Your name">
              <input
                value={business.owner_name || ''} placeholder="Your full name"
                onChange={e => setBusiness(p => ({ ...p, owner_name: e.target.value }))}
                style={input}
                onFocus={e => e.currentTarget.style.borderColor = COLORS.teal}
                onBlur={e => e.currentTarget.style.borderColor = COLORS.border}
              />
            </FieldRow>

            {/* Public links section */}
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', margin: '18px 0 6px' }}>PUBLIC LINKS</div>
            <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12, lineHeight: 1.5 }}>
              MiniMe shares these with clients on request — portfolio for design questions, Instagram for samples, address for visits, etc.
            </p>

            {LINKS.map(([label, key, ph]) => (
              <FieldRow key={key} label={label}>
                <input
                  value={business[key] || ''} placeholder={ph}
                  onChange={e => setBusiness(p => ({ ...p, [key]: e.target.value }))}
                  style={input}
                  onFocus={e => e.currentTarget.style.borderColor = COLORS.teal}
                  onBlur={e => e.currentTarget.style.borderColor = COLORS.border}
                />
              </FieldRow>
            ))}

            <button
              onClick={save}
              disabled={saving}
              style={{
                appearance: 'none', border: 'none',
                background: saving ? COLORS.teal + '70' : COLORS.teal,
                color: '#FFFFFF', borderRadius: RADII.md,
                padding: '13px 20px', fontSize: 14, fontWeight: 600,
                cursor: saving ? 'default' : 'pointer', fontFamily: FONT.body,
                display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
              }}
            >
              <Save size={16} />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* Navigation rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {NAV_SECTIONS.map(({ href, icon: Icon, label, desc, badge }) => (
            <Link key={href} href={href} style={{ textDecoration: 'none' }}>
              <div style={{
                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card,
                display: 'flex', alignItems: 'center', gap: 14,
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.teal + '60'}
              onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.border}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: RADII.sm,
                  background: COLORS.teal + '15',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Icon size={18} color={COLORS.teal} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{label}</span>
                    {badge && (
                      <span style={{
                        fontSize: 10, padding: '2px 7px', background: COLORS.tealLight,
                        color: COLORS.teal, borderRadius: 999, fontWeight: 600, letterSpacing: '0.04em',
                      }}>{badge}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>{desc}</div>
                </div>
                <ChevronRight size={16} color={COLORS.textHint} />
              </div>
            </Link>
          ))}
        </div>

        {/* Admin Panel — only visible to platform admins */}
        {isAdmin && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 8 }}>PLATFORM ADMIN</div>
            <Link href="/admin" style={{ textDecoration: 'none' }}>
              <div style={{
                background: '#1A0F08', border: '1px solid #3D2B1A',
                borderRadius: RADII.lg, padding: '14px 16px',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: RADII.sm,
                  background: 'rgba(217,164,65,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <LayoutDashboard size={18} color="#D9A441" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#F5ECDC' }}>Admin Panel</div>
                  <div style={{ fontSize: 12, color: '#8A7560', marginTop: 2 }}>All businesses, platform health, files</div>
                </div>
                <ChevronRight size={16} color="#8A7560" />
              </div>
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ fontSize: 12, color: COLORS.textSecondary, display: 'block', marginBottom: 5, fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}
