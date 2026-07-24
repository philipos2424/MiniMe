'use client';
/**
 * Business Profile — edit everything MiniMe uses to answer customers in one place.
 * Name, description, address, phone, hours, social links.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { updateBusiness } from '../../../../lib/updateBusiness';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import SaveBar from '../../../../components/ui/SaveBar';
import { tgAlert, tgConfirm } from '../../../../lib/utils';

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

// Shop logo/cover photo — the image shown on MiniMe Search & Market cards.
// Uploads independently of the rest of the form (no "unsaved changes" gate),
// since a photo is either uploaded or it isn't.
function LogoUploader({ business, initData, setBusiness }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
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
    <Field label="Shop photo" hint="Shown on your MiniMe Search & Market listing — a clear logo or storefront photo helps customers recognize you">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 64, height: 64, borderRadius: RADII.md, overflow: 'hidden', flexShrink: 0,
          background: COLORS.surfaceMuted || '#f2f2f2', border: `1px solid ${COLORS.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {shown
            ? <img src={shown} alt="Shop" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 22 }}>🏪</span>}
        </div>
        <label style={{
          cursor: uploading ? 'default' : 'pointer', fontSize: 13, fontWeight: 600,
          color: uploading ? COLORS.textHint : COLORS.textPrimary,
          padding: '9px 14px', borderRadius: RADII.md, border: `1px solid ${COLORS.border}`,
        }}>
          {uploading ? 'Uploading…' : (business?.logo_url ? 'Change photo' : 'Add photo')}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>
      {error && <div style={{ fontSize: 11, color: '#c0392b', marginTop: 6 }}>{error}</div>}
    </Field>
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
  const { business, setBusiness, initData } = useTelegram() || {};
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', category: '', categories: [], tags: '', location: '',
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
      categories:        (Array.isArray(business.categories) && business.categories.length > 0) ? business.categories : (business.category ? [business.category] : []),
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

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); setDirty(true); }

  async function save() {
    if (!business?.id) return;
    setSaving(true);
    const updates = { ...form };
    // Parse tags: comma-separated string → clean array
    updates.tags = form.tags
      ? form.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      : [];
    // Keep primary category in sync with first category in array
    if (Array.isArray(updates.categories) && updates.categories.length > 0) {
      updates.category = updates.categories[0];
    }
    // Clean empty strings to null
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
      'Delete your account and all personal data? Customers, conversations, messages, documents and products will be permanently erased. Your order history is kept for accounting/legal reasons. This cannot be undone.'
    );
    if (!ok) return;
    setDeleting(true);
    try {
      // Step 1 — request a confirmation token
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
      // Step 2 — confirm + execute
      const r2 = await fetch('/api/businesses/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ confirm: true, token: j1.confirm_token }),
      });
      const j2 = await r2.json();
      if (!r2.ok || !j2.ok) {
        tgAlert(j2.detail || j2.error || 'Deletion failed. Please try again or contact support.');
        setDeleting(false);
        return;
      }
      await tgAlert('Your account has been deleted and your personal data removed. Thank you for trying MiniMe.');
      if (setBusiness) setBusiness(null);
      window.location.href = '/';
    } catch (e) {
      tgAlert('Could not delete — check your connection and try again.');
      setDeleting(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, paddingBottom: 100 }}>
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
        <LogoUploader business={business} initData={initData} setBusiness={setBusiness} />
        <Field label="Business name" hint="Shown to customers and used in MiniMe's replies">
          <input value={form.name} onChange={e => set('name', e.target.value)} style={INPUT} placeholder="e.g. Selam Boutique" />
        </Field>
        <Field label="Categories" hint="Pick up to 3 — your business appears in all selected categories in search">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            {CATEGORIES.map(c => {
              const selected = (form.categories || []).includes(c.id);
              const atLimit  = (form.categories || []).length >= 3 && !selected;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={atLimit}
                  onClick={() => {
                    const curr = form.categories || [];
                    set('categories', selected
                      ? curr.filter(x => x !== c.id)
                      : [...curr, c.id].slice(0, 3)
                    );
                  }}
                  style={{
                    padding: '5px 12px', borderRadius: 20, border: 'none', cursor: atLimit ? 'default' : 'pointer',
                    fontSize: 12, fontWeight: 500,
                    background: selected ? COLORS.ink : COLORS.surface,
                    color: selected ? '#fff' : atLimit ? COLORS.textHint : COLORS.textPrimary,
                    border: `1px solid ${selected ? COLORS.ink : COLORS.border}`,
                    opacity: atLimit ? 0.45 : 1,
                    transition: 'all 0.12s',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          {(form.categories || []).length === 0 && (
            <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 6 }}>
              Select at least one category
            </div>
          )}
          {(form.categories || []).length > 0 && (
            <div style={{ fontSize: 11, color: COLORS.teal, marginTop: 6 }}>
              {(form.categories || []).length}/3 selected · primary: {CATEGORIES.find(c => c.id === form.categories[0])?.label}
            </div>
          )}
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

      {/* Danger zone — account deletion */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.red}`, borderRadius: RADII.lg, padding: '16px 18px', marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.red, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Danger Zone</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 4 }}>Delete account</div>
        <p style={{ fontSize: 12.5, color: COLORS.textSecondary, margin: '0 0 14px', lineHeight: 1.5 }}>
          Permanently erases your account and all personal data — customers, conversations, messages, documents and products.
          Your order history is kept for accounting and legal compliance. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={deleteAccount}
          disabled={deleting}
          style={{
            padding: '10px 16px', borderRadius: RADII.md, border: `1px solid ${COLORS.red}`,
            background: 'transparent', color: COLORS.red, fontSize: 13, fontWeight: 600,
            fontFamily: FONT.body, cursor: deleting ? 'wait' : 'pointer', opacity: deleting ? 0.6 : 1,
          }}
        >
          {deleting ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>

      <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={save} label="Save profile" />
    </div>
  );
}
