'use client';
/**
 * Business Profile — edit everything MiniMe uses to answer customers in one place.
 * Features:
 * - 3 bite-sized tabs (Identity, Contact, Socials) to eliminate scrolling & fatigue.
 * - iOS-style colorful micro-icon badges for instant visual recognition.
 * - Elevated artisanal branding card with store avatar photo upload.
 * - Zero word clutter (no repetitive explanatory paragraphs).
 * - Theme-aware styling (light & dark mode compatible).
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { updateBusiness } from '../../../../lib/updateBusiness';
import SaveBar from '../../../../components/ui/SaveBar';
import PrivateContactDetails from '../../../../components/onboarding/PrivateContactDetails';
import { tgAlert, tgConfirm } from '../../../../lib/utils';

// ─── Tokens (Theme-aware CSS variables) ──────────────────────────────────────
const INK   = 'var(--ink)';
const PAPER = 'var(--paper)';
const CARD  = 'var(--card)';
const CREAM = 'var(--cream)';
const CREAM2= 'var(--cream-2)';
const GOLD  = 'var(--gold)';
const MINT  = 'var(--mint)';
const LINE  = 'var(--line)';
const LINE2 = 'var(--line-soft)';
const MUTED = 'var(--muted)';
const ERROR = 'var(--error)';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const CATEGORIES = [
  { id: 'clothing_fashion',      label: '👗 Clothing & Fashion' },
  { id: 'catering_food',         label: '🍽️ Catering & Food' },
  { id: 'food_beverage',         label: '🍕 Restaurant & Café' },
  { id: 'beauty_wellness',       label: '💅 Beauty & Wellness' },
  { id: 'electronics_phones',    label: '📱 Electronics & Phones' },
  { id: 'branding_design',       label: '🎨 Branding & Design' },
  { id: 'printing_signage',      label: '🖨️ Printing & Signage' },
  { id: 'photography_video',     label: '📸 Photography & Video' },
  { id: 'it_tech',               label: '💻 IT & Tech' },
  { id: 'events_entertainment',  label: '🎉 Events & Entertainment' },
  { id: 'construction_interior', label: '🏗️ Construction & Interior' },
  { id: 'transport_delivery',    label: '🚚 Transport & Delivery' },
  { id: 'training_consulting',   label: '📚 Training & Consulting' },
  { id: 'wholesale_supply',      label: '📦 Wholesale & Supply' },
  { id: 'vehicles_automotive',   label: '🚗 Vehicles & Automotive' },
  { id: 'other',                 label: '🏢 Other' },
];

function FieldCard({ icon, iconBg, iconColor, label, labelColor, hint, children, action }) {
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${LINE2}`,
      borderRadius: 16,
      padding: '12px 14px',
      marginBottom: 10,
      boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      transition: 'border-color 0.15s ease',
    }}>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: 11,
        background: iconBg,
        color: iconColor || INK,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        flexShrink: 0,
        boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <label style={{
            display: 'block',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: labelColor || MUTED,
          }}>
            {label}
          </label>
          {action}
        </div>
        {children}
        {hint && (
          <div style={{ fontSize: 11, color: MUTED, marginTop: 3, lineHeight: 1.3 }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

const CARD_INPUT = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 0',
  border: 'none',
  background: 'transparent',
  fontSize: 13.5,
  fontWeight: 600,
  fontFamily: BODY,
  color: INK,
  outline: 'none',
};

const CARD_TEXTAREA = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 0',
  border: 'none',
  background: 'transparent',
  fontSize: 13,
  fontWeight: 500,
  fontFamily: BODY,
  color: INK,
  outline: 'none',
  resize: 'vertical',
  lineHeight: 1.45,
};

const CARD_SELECT = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 0',
  border: 'none',
  background: 'transparent',
  fontSize: 13.5,
  fontWeight: 600,
  fontFamily: BODY,
  color: INK,
  outline: 'none',
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%238A9590%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0 center',
  paddingRight: 24,
};

function LogoUploader({ business, initData, setBusiness }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/settings/logo', {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      setBusiness?.(prev => ({ ...prev, logo_url: j.logo_url }));
    } catch (err) {
      setError(err.message || 'Could not upload — try again');
      setPreview(null);
    } finally {
      setUploading(false);
    }
  }

  const shown = preview || business?.logo_url;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(14, 44, 36, 0.05) 0%, rgba(200, 169, 110, 0.09) 100%)',
      border: `1px solid ${LINE2}`,
      borderRadius: 18,
      padding: '14px 16px',
      marginBottom: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    }}>
      <label style={{
        position: 'relative',
        cursor: uploading ? 'default' : 'pointer',
        flexShrink: 0,
        display: 'block',
      }}>
        <div style={{
          width: 60,
          height: 60,
          borderRadius: 16,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #0B2A22 0%, #164D3F 100%)',
          border: '2px solid rgba(200, 169, 110, 0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#F9E29D',
          fontSize: 26,
          boxShadow: '0 4px 12px rgba(11, 42, 34, 0.2)',
        }}>
          {shown ? (
            <img src={shown} alt="Shop logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span>👜</span>
          )}
        </div>
        <div style={{
          position: 'absolute',
          bottom: -3,
          right: -3,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: MINT,
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          border: `2px solid ${CARD}`,
          boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
        }}>
          📷
        </div>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onPick}
          disabled={uploading}
          style={{ display: 'none' }}
        />
      </label>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: GOLD,
          background: 'rgba(200, 169, 110, 0.12)',
          padding: '2px 8px',
          borderRadius: 6,
          marginBottom: 4,
        }}>
          ★ Store Avatar
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 2 }}>
          {shown ? 'Custom Shop Photo' : 'Add Brand Photo'}
        </div>
        <label style={{
          cursor: uploading ? 'default' : 'pointer',
          fontSize: 11.5,
          fontWeight: 600,
          color: MINT,
          textDecoration: 'underline',
          display: 'inline-block',
        }}>
          {uploading ? 'Uploading…' : (shown ? 'Change photo' : 'Upload photo')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onPick}
            disabled={uploading}
            style={{ display: 'none' }}
          />
        </label>
        {error && <div style={{ fontSize: 11, color: ERROR, marginTop: 4 }}>{error}</div>}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { business, setBusiness, initData } = useTelegram() || {};
  const [activeTab, setActiveTab] = useState('identity');
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', category: '', tags: '', location: '',
    address: '', owner_name: '', owner_phone: '', business_hours: '',
    website: '', instagram: '', tiktok: '', facebook: '',
    telegram_channel: '', whatsapp: '', email: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!business) return;
    setForm({
      name:              business.name              || '',
      description:       business.description       || '',
      category:          business.category          || (Array.isArray(business.categories) ? business.categories[0] : '') || '',
      tags:              Array.isArray(business.tags) ? business.tags.join(', ') : (business.tags || ''),
      location:          business.location          || '',
      address:           business.address           || '',
      owner_name:        business.owner_name        || '',
      owner_phone:       business.owner_phone       || '',
      business_hours:    business.business_hours    || '',
      website:           business.website           || '',
      instagram:         business.instagram         || '',
      tiktok:            business.tiktok            || '',
      facebook:          business.facebook          || '',
      telegram_channel:  business.telegram_channel  || '',
      whatsapp:          business.whatsapp          || '',
      email:             business.email             || '',
    });
  }, [business?.id]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); setDirty(true); }

  async function save() {
    if (!business?.id) return;
    setSaving(true);
    const updates = { ...form };
    updates.tags = form.tags
      ? form.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      : [];
    updates.categories = form.category ? [form.category] : [];
    Object.keys(updates).forEach(k => { if (updates[k] === '') updates[k] = null; });

    try {
      await updateBusiness(initData, updates);
      setBusiness(b => ({ ...b, ...updates }));
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount() {
    if (!initData || deleting) return;
    const ok = await tgConfirm(
      'Delete your account and all personal data? Customers, conversations, messages, documents and products will be permanently erased. This cannot be undone.'
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const r1 = await fetch('/api/businesses/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({}),
      });
      const j1 = await r1.json();
      if (!r1.ok || !j1.confirm_token) {
        tgAlert(j1.detail || j1.error || 'Could not start deletion.');
        setDeleting(false);
        return;
      }
      const r2 = await fetch('/api/businesses/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ confirm: true, token: j1.confirm_token }),
      });
      const j2 = await r2.json();
      if (!r2.ok || !j2.ok) {
        tgAlert(j2.detail || j2.error || 'Deletion failed.');
        setDeleting(false);
        return;
      }
      await tgAlert('Your account has been deleted.');
      if (setBusiness) setBusiness(null);
      window.location.href = '/';
    } catch (e) {
      tgAlert('Could not delete — check your connection.');
      setDeleting(false);
    }
  }

  const selectedCategory = CATEGORIES.find(c => c.id === form.category);
  const categoryEmoji = selectedCategory ? selectedCategory.label.split(' ')[0] : '✨';

  return (
    <div style={{ background: PAPER, minHeight: '100vh', padding: '16px 18px 140px', fontFamily: BODY, color: INK }}>
      {/* Page Title & Context */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD, marginBottom: 3 }}>
          Store Settings
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, color: INK, letterSpacing: '-0.015em', lineHeight: 1.2 }}>
          {form.name || 'Your Shop'}
        </div>
      </div>

      {/* Colorful 3-Tab Segment Switcher */}
      <div style={{
        background: CREAM2,
        borderRadius: 14,
        padding: 4,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 4,
        marginBottom: 16,
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)',
      }}>
        {[
          { id: 'identity', icon: '🏪', label: 'Identity' },
          { id: 'contact',  icon: '📍', label: 'Contact' },
          { id: 'socials',  icon: '🌐', label: 'Socials' },
        ].map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '10px 4px',
                borderRadius: 11,
                border: 'none',
                background: active ? INK : 'transparent',
                color: active ? '#FFFFFF' : MUTED,
                fontSize: 12.5,
                fontWeight: active ? 700 : 600,
                cursor: 'pointer',
                fontFamily: BODY,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                boxShadow: active ? '0 3px 8px rgba(0,0,0,0.15)' : 'none',
                transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <span style={{ fontSize: 13 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* ─── TAB 1: IDENTITY ─── */}
      {activeTab === 'identity' && (
        <div>
          <LogoUploader business={business} initData={initData} setBusiness={setBusiness} />

          <FieldCard
            icon="🏷️"
            iconBg="rgba(16, 185, 129, 0.14)"
            label="Business Name"
            labelColor="#047857"
          >
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              style={CARD_INPUT}
              placeholder="e.g. Habesha Leather Works"
            />
          </FieldCard>

          <FieldCard
            icon="👤"
            iconBg="rgba(99, 102, 241, 0.14)"
            label="Owner Name"
            labelColor="#4338CA"
          >
            <input
              value={form.owner_name}
              onChange={e => set('owner_name', e.target.value)}
              style={CARD_INPUT}
              placeholder="e.g. Blen Tesfaye"
            />
          </FieldCard>

          <FieldCard
            icon={categoryEmoji}
            iconBg="rgba(245, 158, 11, 0.15)"
            label="Primary Category"
            labelColor="#B45309"
          >
            <select
              value={form.category}
              onChange={e => set('category', e.target.value)}
              style={CARD_SELECT}
            >
              <option value="">Select category…</option>
              {CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </FieldCard>

          <FieldCard
            icon="📝"
            iconBg="rgba(14, 165, 233, 0.14)"
            label="About Your Shop"
            labelColor="#0369A1"
          >
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={3}
              style={CARD_TEXTAREA}
              placeholder="e.g. Handcrafted authentic Ethiopian leather bags, wallets, and accessories in Addis Ababa."
            />
          </FieldCard>

          <FieldCard
            icon="🔍"
            iconBg="rgba(20, 184, 166, 0.14)"
            label="Keywords / Tags"
            labelColor="#0F766E"
          >
            <input
              value={form.tags}
              onChange={e => set('tags', e.target.value)}
              style={CARD_INPUT}
              placeholder="e.g. leather, bags, handcrafted, accessories"
            />
          </FieldCard>
        </div>
      )}

      {/* ─── TAB 2: CONTACT & LOCATION ─── */}
      {activeTab === 'contact' && (
        <div>
          <FieldCard
            icon="📞"
            iconBg="rgba(16, 185, 129, 0.14)"
            label="Phone Number"
            labelColor="#047857"
          >
            <input
              value={form.owner_phone}
              onChange={e => set('owner_phone', e.target.value)}
              style={CARD_INPUT}
              placeholder="+251 911 234 567"
              type="tel"
            />
          </FieldCard>

          <FieldCard
            icon="💬"
            iconBg="linear-gradient(135deg, #25D366, #128C7E)"
            iconColor="#FFFFFF"
            label="WhatsApp"
            labelColor="#047857"
            action={
              form.owner_phone && form.whatsapp !== form.owner_phone ? (
                <button
                  type="button"
                  onClick={() => set('whatsapp', form.owner_phone)}
                  style={{
                    background: 'rgba(37, 211, 102, 0.12)',
                    border: '1px solid rgba(37, 211, 102, 0.3)',
                    borderRadius: 6,
                    padding: '2px 7px',
                    fontSize: 9.5,
                    fontWeight: 800,
                    color: '#047857',
                    cursor: 'pointer',
                    fontFamily: BODY,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                  }}
                >
                  Copy Phone
                </button>
              ) : null
            }
          >
            <input
              value={form.whatsapp}
              onChange={e => set('whatsapp', e.target.value)}
              style={CARD_INPUT}
              placeholder="+251 911 234 567"
              type="tel"
            />
          </FieldCard>

          <FieldCard
            icon="📍"
            iconBg="rgba(244, 63, 94, 0.14)"
            label="Physical Address"
            labelColor="#BE123C"
          >
            <input
              value={form.address}
              onChange={e => set('address', e.target.value)}
              style={CARD_INPUT}
              placeholder="e.g. Bole Road, near Edna Mall, Addis Ababa"
            />
          </FieldCard>

          <FieldCard
            icon="🗺️"
            iconBg="rgba(139, 92, 246, 0.14)"
            label="Neighborhood / City"
            labelColor="#6D28D9"
          >
            <input
              value={form.location}
              onChange={e => set('location', e.target.value)}
              style={CARD_INPUT}
              placeholder="e.g. Bole, Addis Ababa"
            />
          </FieldCard>

          <FieldCard
            icon="⏰"
            iconBg="rgba(245, 158, 11, 0.14)"
            label="Opening Hours"
            labelColor="#B45309"
          >
            <input
              value={form.business_hours}
              onChange={e => set('business_hours', e.target.value)}
              style={CARD_INPUT}
              placeholder="e.g. Mon–Sat 9:00 AM – 7:30 PM, Sun closed"
            />
          </FieldCard>

          <FieldCard
            icon="✉️"
            iconBg="rgba(59, 130, 246, 0.14)"
            label="Email Address"
            labelColor="#1D4ED8"
          >
            <input
              value={form.email}
              onChange={e => set('email', e.target.value)}
              style={CARD_INPUT}
              placeholder="contact@shop.com"
              type="email"
            />
          </FieldCard>
        </div>
      )}

      {/* ─── TAB 3: SOCIALS & CHANNELS ─── */}
      {activeTab === 'socials' && (
        <div>
          {[
            {
              key: 'telegram_channel',
              label: 'Telegram Channel',
              icon: '✈️',
              iconBg: 'linear-gradient(135deg, #2AABEE, #229ED9)',
              iconColor: '#FFFFFF',
              labelColor: '#0284C7',
              placeholder: '@habeshaleather',
            },
            {
              key: 'instagram',
              label: 'Instagram',
              icon: '📸',
              iconBg: 'linear-gradient(45deg, #F58529, #DD2A7B, #8134AF)',
              iconColor: '#FFFFFF',
              labelColor: '#9333EA',
              placeholder: '@habeshaleather',
            },
            {
              key: 'tiktok',
              label: 'TikTok',
              icon: '🎵',
              iconBg: '#111827',
              iconColor: '#FFFFFF',
              labelColor: '#374151',
              placeholder: '@habeshaleather',
            },
            {
              key: 'facebook',
              label: 'Facebook Page',
              icon: '📘',
              iconBg: '#1877F2',
              iconColor: '#FFFFFF',
              labelColor: '#1D4ED8',
              placeholder: 'habeshaleather',
            },
            {
              key: 'website',
              label: 'Website',
              icon: '🌐',
              iconBg: 'rgba(16, 185, 129, 0.14)',
              iconColor: '#047857',
              labelColor: '#047857',
              placeholder: 'https://example.com',
            },
          ].map(({ key, label, icon, iconBg, iconColor, labelColor, placeholder }) => (
            <FieldCard
              key={key}
              icon={icon}
              iconBg={iconBg}
              iconColor={iconColor}
              label={label}
              labelColor={labelColor}
            >
              <input
                value={form[key]}
                onChange={e => set(key, e.target.value)}
                style={CARD_INPUT}
                placeholder={placeholder}
              />
            </FieldCard>
          ))}

          {/* Private Contact Details component */}
          <div style={{ marginTop: 14, marginBottom: 14 }}>
            <PrivateContactDetails initData={initData} businessId={business?.id} />
          </div>

          {/* Danger Zone */}
          <div style={{
            background: 'rgba(239, 68, 68, 0.05)',
            border: '1px solid rgba(239, 68, 68, 0.22)',
            borderRadius: 16,
            padding: '14px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(239, 68, 68, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                flexShrink: 0,
              }}>
                ⚠️
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: ERROR }}>Delete Account</div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>Permanently erase store data</div>
              </div>
            </div>
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deleting}
              style={{
                padding: '7px 12px',
                borderRadius: 9,
                border: `1px solid ${ERROR}`,
                background: 'transparent',
                color: ERROR,
                fontSize: 11.5,
                fontWeight: 700,
                fontFamily: BODY,
                cursor: deleting ? 'wait' : 'pointer',
                opacity: deleting ? 0.6 : 1,
                flexShrink: 0,
              }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {/* Sticky Bottom Save Bar */}
      <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={save} label="Save Profile" />
    </div>
  );
}
