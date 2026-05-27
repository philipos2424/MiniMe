'use client';
/**
 * Network & B2B Settings — control visibility, auto-negotiation, blocklist.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import SaveBar from '../../../../components/ui/SaveBar';

const INPUT = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 13px', borderRadius: RADII.md,
  border: `1px solid ${COLORS.border}`, background: COLORS.surface,
  fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary,
  outline: 'none', transition: 'border-color 0.15s',
};

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

function Toggle({ checked, onChange, label, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          flexShrink: 0, marginTop: 2,
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: checked ? COLORS.green : COLORS.border,
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 22 : 2,
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
        }} />
      </button>
      <div>
        <div style={{ fontSize: 15, fontWeight: 500, color: COLORS.textPrimary }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
      </div>
    </div>
  );
}

export default function NetworkSettingsPage() {
  const { business, setBusiness } = useTelegram() || {};
  const supabase = createClient();

  const [form, setForm] = useState({
    b2b_discoverable: true,
    b2b_auto_negotiate: false,
    min_sell_price: '',
    max_discount_pct: '',
    max_budget_buy: '',
  });
  const [blocklist, setBlocklist] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!business) return;
    const limits = business.notification_prefs?.b2b_limits || {};
    setForm({
      b2b_discoverable: business.b2b_discoverable !== false,
      b2b_auto_negotiate: !!business.b2b_auto_negotiate,
      min_sell_price: limits.min_sell_price ?? '',
      max_discount_pct: limits.max_discount_pct ?? '',
      max_budget_buy: limits.max_budget_buy ?? '',
    });
    setBlocklist(Array.isArray(business.b2b_blocklist) ? business.b2b_blocklist : []);
  }, [business?.id]); // eslint-disable-line

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function removeFromBlocklist(id) {
    setBlocklist(bl => bl.filter(x => String(x) !== String(id)));
  }

  async function save() {
    if (!business?.id) return;
    setSaving(true);

    const currentPrefs = business.notification_prefs || {};
    const limits = {};
    if (form.min_sell_price !== '') limits.min_sell_price = Number(form.min_sell_price);
    if (form.max_discount_pct !== '') limits.max_discount_pct = Number(form.max_discount_pct);
    if (form.max_budget_buy !== '') limits.max_budget_buy = Number(form.max_budget_buy);

    const updates = {
      b2b_discoverable: form.b2b_discoverable,
      b2b_auto_negotiate: form.b2b_auto_negotiate,
      notification_prefs: { ...currentPrefs, b2b_limits: limits },
      b2b_blocklist: blocklist,
    };

    await supabase.from('businesses').update(updates).eq('id', business.id);
    setBusiness(b => ({ ...b, ...updates }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    setSaving(false);
  }

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, paddingBottom: 100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 6px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
          Network & B2B
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
          Control how other businesses discover and interact with you on the MiniMe Network.
        </p>
      </div>

      {/* Visibility */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Visibility</div>
        <Toggle
          checked={form.b2b_discoverable}
          onChange={v => set('b2b_discoverable', v)}
          label="Appear on MiniMe Network"
          hint="Other businesses can find and connect with you in the Browse directory"
        />
      </div>

      {/* AI Negotiation */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>AI Negotiation</div>
        <Toggle
          checked={form.b2b_auto_negotiate}
          onChange={v => set('b2b_auto_negotiate', v)}
          label="Auto-negotiate"
          hint="MiniMe automatically replies to B2B inquiries using your catalog and the limits below"
        />
        <Field label="Minimum sell price (ETB)" hint="MiniMe won't accept offers below this amount">
          <input
            type="number" min="0" step="1"
            value={form.min_sell_price}
            onChange={e => set('min_sell_price', e.target.value)}
            style={INPUT}
            placeholder="e.g. 500"
          />
        </Field>
        <Field label="Maximum discount (%)" hint="Cap on discounts MiniMe can offer in negotiations">
          <input
            type="number" min="0" max="100" step="1"
            value={form.max_discount_pct}
            onChange={e => set('max_discount_pct', e.target.value)}
            style={INPUT}
            placeholder="e.g. 15"
          />
        </Field>
        <Field label="Maximum buy budget (ETB)" hint="Cap on purchase amounts MiniMe can commit to on your behalf">
          <input
            type="number" min="0" step="1"
            value={form.max_budget_buy}
            onChange={e => set('max_budget_buy', e.target.value)}
            style={INPUT}
            placeholder="e.g. 50000"
          />
        </Field>
      </div>

      {/* Blocklist */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Blocked Businesses</div>
        {blocklist.length === 0 ? (
          <div style={{ fontSize: 13, color: COLORS.textHint, fontStyle: 'italic' }}>
            No blocked businesses — businesses you block from B2B messaging will appear here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {blocklist.map(id => (
              <span key={id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: COLORS.redLight, color: COLORS.red,
                padding: '5px 10px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              }}>
                ID: {String(id)}
                <button
                  onClick={() => removeFromBlocklist(id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: COLORS.red, fontSize: 16, lineHeight: 1, padding: 0,
                  }}
                  title="Unblock"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <SaveBar saving={saving} saved={saved} onSave={save} label="Save settings" />
    </div>
  );
}
