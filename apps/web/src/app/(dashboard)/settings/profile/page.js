'use client';
/**
 * Business Profile — edit everything MiniMe uses to answer customers in one place.
 * Name, description, address, phone, hours, social links.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

const CATEGORIES = [
  { id: 'branding_design',       label: '🎨 Branding & Design' },
  { id: 'printing_signage',      label: '🖨️ Printing & Signage' },
  { id: 'photography_video',     label: '📸 Photography & Video' },
  { id: 'catering_food',         label: '🍽️ Catering & Food' },
  { id: 'food_beverage',         label: '🍕 Restaurant & Café' },
  { id: 'it_tech',               label: '💻 IT & Tech' },
  { id: 'events_entertainment',  label: '🎉 Events & Entertainment' },
  { id: 'clothing_fashion',      label: '👗 Clothing & Fashion' },
  { id: 'beauty_wellness',       label: '💅 Beauty & Wellness' },
  { id: 'construction_interior', label: '🏗️ Construction & Interior' },
  { id: 'transport_delivery',    label: '🚚 Transport & Delivery' },
  { id: 'training_consulting',   label: '📚 Training & Consulting' },
  { id: 'wholesale_supply',      label: '📦 Wholesale & Supply' },
  { id: 'electronics_phones',    label: '📱 Electronics & Phones' },
  { id: 'other',                 label: '🏢 Other' },
];

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

const INPUT = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 13px', borderRadius: RADII.md,
  border: `1px solid ${COLORS.border}`, background: COLORS.surface,
  fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary,
  outline: 'none', transition: 'border-color 0.15s',
};

export default function ProfilePage() {
  const { business, setBusiness } = useTelegram() || {};
  const supabase = createClient();
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
      category:          business.category          || '',
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
  }, [business?.id]); // eslint-disable-line

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function save() {
    if (!business?.id) return;
    setSaving(true);
    const updates = { ...form };
    // Parse tags: comma-separated string → clean array
    updates.tags = form.tags
      ? form.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      : [];
    // Clean empty strings to null
    Object.keys(updates).forEach(k => { if (updates[k] === '') updates[k] = null; });
    await supabase.from('businesses').update(updates).eq('id', business.id);
    setBusiness(b => ({ ...b, ...updates }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    setSaving(false);
  }

  const inputStyle = {
    ...INPUT,
    onFocus: e => (e.target.style.borderColor = COLORS.teal),
    onBlur:  e => (e.target.style.borderColor = COLORS.border),
  };

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, paddingBottom: 40 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 6px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
          Business Profile
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
          MiniMe uses every field here when answering customers — the more you fill in, the better the replies.
        </p>
      </div>

      {/* Core identity */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Identity</div>
        <Field label="Business name" hint="Shown to customers and used in MiniMe's replies">
          <input value={form.name} onChange={e => set('name', e.target.value)} style={INPUT} placeholder="e.g. Selam Boutique" />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={e => set('category', e.target.value)} style={{ ...INPUT, appearance: 'none' }}>
            <option value="">Select…</option>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Tags" hint="Keywords other businesses use to find you — e.g. leather, handmade, wholesale, fast delivery. Comma-separated.">
          <input
            value={form.tags}
            onChange={e => set('tags', e.target.value)}
            style={INPUT}
            placeholder="e.g. leather, handmade, wholesale, custom orders"
          />
        </Field>
        <Field label="Description" hint="MiniMe shares this when customers ask 'what do you sell?' or 'tell me about your shop'">
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3}
            style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }}
            placeholder="We sell handmade leather bags and accessories, crafted in Addis Ababa…" />
        </Field>
        <Field label="Your name">
          <input value={form.owner_name} onChange={e => set('owner_name', e.target.value)} style={INPUT} placeholder="e.g. Sara Tesfaye" />
        </Field>
      </div>

      {/* Contact & location */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Contact & Location</div>
        <Field label="Phone number" hint="MiniMe shares this when customers ask for your number">
          <input value={form.owner_phone} onChange={e => set('owner_phone', e.target.value)} style={INPUT} placeholder="+251 911 234 567" type="tel" />
        </Field>
        <Field label="WhatsApp" hint="If different from phone">
          <input value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} style={INPUT} placeholder="+251 911 234 567" />
        </Field>
        <Field label="Address" hint="MiniMe uses this when customers ask 'where are you?'">
          <input value={form.address} onChange={e => set('address', e.target.value)} style={INPUT} placeholder="e.g. Bole Road, near Edna Mall, Addis Ababa" />
        </Field>
        <Field label="Area / neighbourhood" hint="General location — e.g. Bole, Piazza, CMC">
          <input value={form.location} onChange={e => set('location', e.target.value)} style={INPUT} placeholder="e.g. Bole, Addis Ababa" />
        </Field>
        <Field label="Opening hours" hint="MiniMe tells customers when you're open">
          <input value={form.business_hours} onChange={e => set('business_hours', e.target.value)} style={INPUT} placeholder="e.g. Mon–Sat 9am–8pm, Sun closed" />
        </Field>
        <Field label="Email">
          <input value={form.email} onChange={e => set('email', e.target.value)} style={INPUT} placeholder="you@example.com" type="email" />
        </Field>
      </div>

      {/* Social & online */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Online Presence</div>
        {[
          { key: 'instagram',        label: 'Instagram',         placeholder: '@yourshop' },
          { key: 'facebook',         label: 'Facebook page',     placeholder: 'yourpage' },
          { key: 'tiktok',           label: 'TikTok',            placeholder: '@yourhandle' },
          { key: 'telegram_channel', label: 'Telegram channel',  placeholder: '@yourchannel' },
          { key: 'website',          label: 'Website',           placeholder: 'https://yourshop.com' },
        ].map(({ key, label, placeholder }) => (
          <Field key={key} label={label}>
            <input value={form[key]} onChange={e => set(key, e.target.value)} style={INPUT} placeholder={placeholder} />
          </Field>
        ))}
      </div>

      {saved && (
        <div style={{ color: COLORS.green, fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          ✓ Profile saved — MiniMe now has your latest info
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        style={{
          width: '100%', background: saving ? COLORS.textHint : COLORS.textPrimary,
          color: '#fff', fontWeight: 600, padding: '14px 0',
          borderRadius: RADII.lg, border: 'none', fontSize: 15,
          cursor: saving ? 'default' : 'pointer', fontFamily: FONT.body,
        }}
      >
        {saving ? 'Saving…' : 'Save profile'}
      </button>
    </div>
  );
}
