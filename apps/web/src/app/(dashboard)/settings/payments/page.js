'use client';
/**
 * Payment methods — toggle Chapa, Telegram Stars, and CBE manual transfer.
 * Stored in businesses.notification_prefs.payments
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { CreditCard, Star, Landmark } from 'lucide-react';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

const INPUT_BASE = {
  background: COLORS.bg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADII.md,
  padding: '8px 12px',
  minHeight: 40,
  fontSize: 13,
  color: COLORS.textPrimary,
  fontFamily: FONT.body,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

export default function PaymentsPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [cfg, setCfg] = useState({
    chapa: true, telegram_stars: false, stars_per_etb: 1,
    cbe_manual: false, cbe_account: '', cbe_name: '', cbe_phone: '',
  });
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!initData) return;
    (async () => {
      const r = await fetch('/api/settings/payments', { headers: { 'x-telegram-init-data': initData } });
      const j = await r.json();
      if (j.payments) setCfg(c => ({ ...c, ...j.payments }));
    })();
  }, [initData]);

  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const bb = twa?.BackButton;
    if (!bb) return;
    const onBack = () => router.push('/settings');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/settings/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(cfg),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      try {
        await fetch('/api/bot/refresh-webhook', { method: 'POST', headers: { 'x-telegram-init-data': initData } });
      } catch {}
      setSavedAt(new Date());
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 40, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Payments</h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>
          How customers pay you. Mix and match — they pick what works for them.
        </p>
      </header>

      <Method
        icon={<CreditCard size={20} color={COLORS.green} />}
        title="Chapa"
        subtitle="Telebirr, CBE Birr, M-Pesa, cards. Standard Chapa fees."
        on={cfg.chapa}
        onToggle={v => setCfg(c => ({ ...c, chapa: v }))}
      />

      <Method
        icon={<Star size={20} color={COLORS.amber} />}
        title="Telegram Stars"
        subtitle="Pay in-app with Telegram's built-in currency. Zero setup, no external gateway."
        on={cfg.telegram_stars}
        onToggle={v => setCfg(c => ({ ...c, telegram_stars: v }))}
      >
        {cfg.telegram_stars && (
          <Field label="Stars per 1 ETB">
            <input
              type="number" min={0.1} step={0.1} inputMode="decimal"
              value={cfg.stars_per_etb}
              onChange={e => setCfg(c => ({ ...c, stars_per_etb: Number(e.target.value) || 1 }))}
              style={INPUT_BASE}
            />
            <p style={{ fontSize: 11, color: COLORS.textHint, margin: '4px 0 0' }}>
              A 1,500 ETB order at this rate = {Math.round(1500 * (cfg.stars_per_etb || 1))} stars. Telegram converts Stars to USD for you (~$0.013/star).
            </p>
          </Field>
        )}
      </Method>

      <Method
        icon={<Landmark size={20} color='#3B82F6' />}
        title="CBE bank transfer"
        subtitle="Customer transfers to your CBE account, sends a screenshot. You confirm and mark paid."
        on={cfg.cbe_manual}
        onToggle={v => setCfg(c => ({ ...c, cbe_manual: v }))}
      >
        {cfg.cbe_manual && (
          <>
            <Field label="CBE account number">
              <input value={cfg.cbe_account} onChange={e => setCfg(c => ({ ...c, cbe_account: e.target.value }))} placeholder="1000123456789" style={{ ...INPUT_BASE, fontFamily: 'monospace' }} />
            </Field>
            <Field label="Account name">
              <input value={cfg.cbe_name} onChange={e => setCfg(c => ({ ...c, cbe_name: e.target.value }))} placeholder="Selam Mekonnen" style={INPUT_BASE} />
            </Field>
            <Field label="Phone (optional)">
              <input value={cfg.cbe_phone} onChange={e => setCfg(c => ({ ...c, cbe_phone: e.target.value }))} placeholder="+251 911 123456" style={INPUT_BASE} />
            </Field>
          </>
        )}
      </Method>

      <Method
        icon={<span style={{ fontSize: 20 }}>📱</span>}
        title="Telebirr"
        subtitle="Customer sends Telebirr to your phone, screenshots the confirmation, you confirm."
        on={cfg.telebirr_manual}
        onToggle={v => setCfg(c => ({ ...c, telebirr_manual: v }))}
      >
        {cfg.telebirr_manual && (
          <>
            <Field label="Telebirr phone number">
              <input value={cfg.telebirr_phone || ''} onChange={e => setCfg(c => ({ ...c, telebirr_phone: e.target.value }))} placeholder="+251 911 123456" style={{ ...INPUT_BASE, fontFamily: 'monospace' }} />
            </Field>
            <Field label="Account name">
              <input value={cfg.telebirr_name || ''} onChange={e => setCfg(c => ({ ...c, telebirr_name: e.target.value }))} placeholder="Selam Mekonnen" style={INPUT_BASE} />
            </Field>
          </>
        )}
      </Method>

      {err && (
        <div style={{ background: COLORS.redLight, border: `1px solid ${COLORS.red}40`, borderRadius: RADII.md, padding: '10px 14px', fontSize: 13, color: COLORS.red, marginBottom: 12 }}>
          {err}
        </div>
      )}

      <button
        onClick={save}
        disabled={busy}
        style={{
          width: '100%', background: busy ? COLORS.textHint : COLORS.teal,
          color: '#FFF', fontWeight: 600, padding: '12px 0', minHeight: 44,
          borderRadius: RADII.lg, border: 'none', fontSize: 14,
          cursor: busy ? 'default' : 'pointer', fontFamily: FONT.body,
          transition: 'background 0.15s', marginTop: 8,
        }}
      >
        {busy ? 'Saving…' : savedAt ? '✓ Saved' : 'Save'}
      </button>

      <p style={{ fontSize: 11, color: COLORS.textHint, textAlign: 'center', marginTop: 16 }}>
        For Telegram Stars: open <strong>@BotFather</strong> → your bot → <em>Bot Settings → Payments</em> → enable Stars first.
      </p>
    </div>
  );
}

function Method({ icon, title, subtitle, on, onToggle, children }) {
  return (
    <section style={{
      background: COLORS.surface,
      border: `1px solid ${on ? COLORS.teal + '60' : COLORS.border}`,
      borderRadius: RADII.xl,
      padding: 20,
      marginBottom: 12,
      boxShadow: SHADOW.card,
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1 }}>
          <div style={{ marginTop: 2 }}>{icon}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{title}</div>
            <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2 }}>{subtitle}</div>
          </div>
        </div>
        {/* Toggle */}
        <div
          onClick={() => onToggle(!on)}
          style={{
            width: 44, height: 24, borderRadius: 12,
            background: on ? COLORS.teal : COLORS.border,
            cursor: 'pointer', position: 'relative', flexShrink: 0,
            transition: 'background 0.2s',
          }}
        >
          <div style={{
            position: 'absolute', top: 3,
            left: on ? 23 : 3,
            width: 18, height: 18, borderRadius: '50%',
            background: '#FFF', transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </div>
      </div>
      {on && children && <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 12, color: COLORS.textHint, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
