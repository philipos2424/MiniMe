'use client';
/**
 * Business Profile — edit everything MiniMe uses to answer customers in one place.
 * Simplified into 3 clear cards: Identity, Contact, Socials.
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

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.35 }}>{hint}</div>}
    </div>
  );
}

const INPUT = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 14px', borderRadius: 12,
  border: `1px solid ${LINE2}`, background: PAPER,
  fontSize: 14, fontFamily: BODY, color: INK,
  outline: 'none', transition: 'border-color 0.15s',
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
      <div style={{
        width: 58, height: 58, borderRadius: 14, overflow: 'hidden', flexShrink: 0,
        background: CREAM2, border: `1px solid ${LINE2}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {shown
          ? <img src={shown} alt="Shop" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 22 }}>🏪</span>}
      </div>
      <div>
        <label style={{
          cursor: uploading ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600,
          color: uploading ? MUTED : INK, background: CARD,
          padding: '8px 14px', borderRadius: 10, border: `1px solid ${LINE}`,
          fontFamily: BODY, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          {uploading ? 'Uploading…' : (business?.logo_url ? 'Change Photo' : 'Upload Photo')}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} disabled={uploading} style={{ display: 'none' }} />
        </label>
        {error && <div style={{ fontSize: 11.5, color: ERROR, marginTop: 4 }}>{error}</div>}
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

  return (
    <div style={{ background: PAPER, minHeight: '100vh', padding: '16px 18px 140px', fontFamily: BODY, color: INK }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD, marginBottom: 4 }}>
          Business Profile
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 24, color: INK, letterSpacing: '-0.015em', lineHeight: 1.2 }}>
          {form.name || 'Your Shop'}
        </div>
      </div>

      {/* 3-Tab Segment Switcher (Bite-sized, zero visual fatigue) */}
      <div style={{
        background: CREAM2, borderRadius: 12, padding: 3,
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4,
        marginBottom: 18,
      }}>
        {[
          { id: 'identity', label: '1. Identity' },
          { id: 'contact',  label: '2. Contact' },
          { id: 'socials',  label: '3. Socials' },
        ].map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '9px 4px', borderRadius: 9, border: 'none',
                background: active ? CARD : 'transparent',
                color: active ? INK : MUTED,
                fontSize: 12.5, fontWeight: active ? 700 : 500,
                cursor: 'pointer', fontFamily: BODY,
                boxShadow: active ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1 — Identity (Clean, spacious, no word fatigue) */}
      {activeTab === 'identity' && (
        <div style={{
          background: CARD, border: `1px solid ${LINE2}`, borderRadius: 18,
          padding: '18px 16px', marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
        }}>
          <LogoUploader business={business} initData={initData} setBusiness={setBusiness} />

          <Field label="Business Name">
            <input value={form.name} onChange={e => set('name', e.target.value)} style={INPUT} placeholder="e.g. Habesha Leather Works" />
          </Field>

          <Field label="Owner Name">
            <input value={form.owner_name} onChange={e => set('owner_name', e.target.value)} style={INPUT} placeholder="e.g. Blen Tesfaye" />
          </Field>

          <Field label="Primary Category">
            <select
              value={form.category}
              onChange={e => set('category', e.target.value)}
              style={{
                ...INPUT,
                appearance: 'none',
                backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%238A9590%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E")',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 14px center',
                paddingRight: 36,
                cursor: 'pointer',
              }}
            >
              <option value="">Select category…</option>
              {CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>

          <Field label="About Your Shop">
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3}
              style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }}
              placeholder="e.g. Handcrafted authentic Ethiopian leather bags, wallets, and accessories in Addis Ababa." />
          </Field>

          <Field label="Keywords / Tags">
            <input
              value={form.tags}
              onChange={e => set('tags', e.target.value)}
              style={INPUT}
              placeholder="e.g. leather, bags, handcrafted, accessories"
            />
          </Field>
        </div>
      )}

      {/* Tab 2 — Contact & Location (Clean, spacious) */}
      {activeTab === 'contact' && (
        <div style={{
          background: CARD, border: `1px solid ${LINE2}`, borderRadius: 18,
          padding: '18px 16px', marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
        }}>
          <Field label="Phone Number">
            <input value={form.owner_phone} onChange={e => set('owner_phone', e.target.value)} style={INPUT} placeholder="+251 911 234 567" type="tel" />
          </Field>

          <Field label="WhatsApp">
            <div style={{ position: 'relative' }}>
              <input value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} style={INPUT} placeholder="+251 911 234 567" />
              {form.owner_phone && form.whatsapp !== form.owner_phone && (
                <button
                  type="button"
                  onClick={() => set('whatsapp', form.owner_phone)}
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    background: CREAM2, border: `1px solid ${LINE2}`, borderRadius: 8,
                    padding: '4px 8px', fontSize: 10.5, fontWeight: 700, color: MINT,
                    cursor: 'pointer', fontFamily: BODY,
                  }}
                >
                  Same as Phone
                </button>
              )}
            </div>
          </Field>

          <Field label="Physical Address">
            <input value={form.address} onChange={e => set('address', e.target.value)} style={INPUT} placeholder="e.g. Bole Road, near Edna Mall, Addis Ababa" />
          </Field>

          <Field label="Neighborhood / Area">
            <input value={form.location} onChange={e => set('location', e.target.value)} style={INPUT} placeholder="e.g. Bole, Addis Ababa" />
          </Field>

          <Field label="Opening Hours">
            <input value={form.business_hours} onChange={e => set('business_hours', e.target.value)} style={INPUT} placeholder="e.g. Mon–Sat 9:00 AM – 7:30 PM, Sun closed" />
          </Field>

          <Field label="Email Address">
            <input value={form.email} onChange={e => set('email', e.target.value)} style={INPUT} placeholder="contact@shop.com" type="email" />
          </Field>
        </div>
      )}

      {/* Tab 3 — Socials & Account */}
      {activeTab === 'socials' && (
        <>
          <div style={{
            background: CARD, border: `1px solid ${LINE2}`, borderRadius: 18,
            padding: '18px 16px', marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}>
            {[
              { key: 'telegram_channel', label: 'Telegram Channel',  placeholder: '@habeshaleather' },
              { key: 'instagram',        label: 'Instagram',         placeholder: '@habeshaleather' },
              { key: 'tiktok',           label: 'TikTok',            placeholder: '@habeshaleather' },
              { key: 'facebook',         label: 'Facebook Page',     placeholder: 'habeshaleather' },
              { key: 'website',          label: 'Website',           placeholder: 'https://example.com' },
            ].map(({ key, label, placeholder }) => (
              <Field key={key} label={label}>
                <input value={form[key]} onChange={e => set(key, e.target.value)} style={INPUT} placeholder={placeholder} />
              </Field>
            ))}
          </div>

          <PrivateContactDetails initData={initData} businessId={business?.id} />

          <div style={{
            background: CARD, border: `1px solid rgba(192,57,43,.2)`, borderRadius: 18,
            padding: '16px 16px', marginBottom: 20,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: ERROR, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Danger Zone
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 3 }}>Delete Account</div>
            <p style={{ fontSize: 12, color: MUTED, margin: '0 0 12px', lineHeight: 1.45 }}>
              Permanently erases your business account, documents, and products.
            </p>
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deleting}
              style={{
                padding: '9px 14px', borderRadius: 10, border: `1px solid ${ERROR}`,
                background: 'transparent', color: ERROR, fontSize: 12.5, fontWeight: 600,
                fontFamily: BODY, cursor: deleting ? 'wait' : 'pointer', opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? 'Deleting…' : 'Delete Account'}
            </button>
          </div>
        </>
      )}

      <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={save} label="Save Profile" />
    </div>
  );
}
