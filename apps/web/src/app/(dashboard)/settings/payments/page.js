'use client';
/**
 * Payment methods — toggle Chapa, Telegram Stars, and CBE manual transfer.
 * Stored in businesses.notification_prefs.payments
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { CreditCard, Star, Landmark } from 'lucide-react';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import SaveBar, { useUnsavedChanges } from '../../../../components/ui/SaveBar';
import {
  DEFAULT_STARS_PER_ETB, MIN_STARS_PER_ETB, MAX_STARS_PER_ETB,
  isValidStarsPerEtb, normalizeStarsPerEtb, starsForEtb, etbPerStar,
} from '../../../../lib/starsRate.mjs';

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
  const { initData } = useTelegram() || {};
  const [cfg, setCfg] = useState({
    chapa: false, telegram_stars: false, stars_per_etb: DEFAULT_STARS_PER_ETB,
    cbe_manual: false, cbe_account: '', cbe_name: '', cbe_phone: '',
  });
  // Chapa is only offered when the platform has a Chapa key (there isn't one today).
  const [chapaAvailable, setChapaAvailable] = useState(false);
  const [etbInput, setEtbInput] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [err, setErr] = useState('');
  const { dirty, markSaved } = useUnsavedChanges(cfg);

  useEffect(() => {
    if (!initData) return;
    (async () => {
      let next = cfg;
      try {
        const r = await fetch('/api/settings/payments', { headers: { 'x-telegram-init-data': initData } });
        const j = await r.json();
        // A stored rate outside the sane band (3000 was found live) loads as the default.
        if (j.payments) next = { ...cfg, ...j.payments, stars_per_etb: normalizeStarsPerEtb(j.payments.stars_per_etb) };
        setChapaAvailable(!!j.chapa_available);
      } catch {}
      setCfg(next);
      markSaved(next);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initData]);


  async function save() {
    setBusy(true); setErr('');
    const sent = cfg;
    try {
      const r = await fetch('/api/settings/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(sent),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      markSaved(sent);
      try {
        await fetch('/api/bot/refresh-webhook', { method: 'POST', headers: { 'x-telegram-init-data': initData } });
      } catch {}
      setSavedAt(new Date());
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Payments</h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>
          How customers pay you. Mix and match — they pick what works for them.
        </p>
      </header>

      {chapaAvailable && (
        <Method
          icon={<CreditCard size={20} color={COLORS.green} />}
          title="Chapa"
          subtitle="Telebirr, CBE Birr, M-Pesa, cards. Standard Chapa fees."
          on={!!cfg.chapa}
          onToggle={v => setCfg(c => ({ ...c, chapa: v }))}
        />
      )}

      <Method
        icon={<Star size={20} color={COLORS.amber} />}
        title="Telegram Stars"
        subtitle="Pay in-app with Telegram's built-in currency. No external gateway; needs Stars enabled on your bot."
        on={cfg.telegram_stars}
        onToggle={v => setCfg(c => ({ ...c, telegram_stars: v }))}
      >
        {cfg.telegram_stars && (
          <Field label="1 Star is worth (ETB)">
            <input
              type="number" min={etbPerStar(MAX_STARS_PER_ETB)} max={etbPerStar(MIN_STARS_PER_ETB)} step={0.01} inputMode="decimal"
              value={etbInput ?? etbPerStar(cfg.stars_per_etb)}
              onChange={e => {
                setEtbInput(e.target.value);
                const etb = Number(e.target.value);
                if (etb > 0) setCfg(c => ({ ...c, stars_per_etb: 1 / etb }));
              }}
              style={INPUT_BASE}
            />
            <p style={{ fontSize: 11, color: isValidStarsPerEtb(cfg.stars_per_etb) ? COLORS.textHint : COLORS.red, margin: '4px 0 0' }}>
              {isValidStarsPerEtb(cfg.stars_per_etb)
                ? `A 1,500 ETB order = ${starsForEtb(1500, cfg.stars_per_etb).toLocaleString()} Stars. One Star is about $0.013, so about ${etbPerStar(DEFAULT_STARS_PER_ETB)} ETB is a fair rate.`
                : `Enter a value between ${etbPerStar(MAX_STARS_PER_ETB)} and ${etbPerStar(MIN_STARS_PER_ETB)} ETB.`}
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

      <p style={{ fontSize: 11, color: COLORS.textHint, textAlign: 'center', marginTop: 4, marginBottom: 80 }}>
        For Telegram Stars: open <strong>@BotFather</strong> → your bot → <em>Bot Settings → Payments</em> → enable Stars first.
      </p>
      <SaveBar dirty={dirty} saving={busy} saved={!!savedAt} onSave={save} />
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
