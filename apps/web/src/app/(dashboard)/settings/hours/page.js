'use client';
/**
 * Quiet hours / DND settings.
 * Stored in businesses.notification_prefs.dnd:
 *   { enabled, start_hour, end_hour, timezone, message, mode }
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { Moon } from 'lucide-react';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import SaveBar from '../../../../components/ui/SaveBar';

const DEFAULT_MSG = "Hi! Our shop is closed right now. I've noted your message and we'll reply first thing in the morning. 🌙";

const INPUT_BASE = {
  background: COLORS.bg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADII.md,
  padding: '8px 12px',
  minHeight: 40,
  fontSize: 14,
  color: COLORS.textPrimary,
  fontFamily: FONT.body,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

export default function HoursPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [cfg, setCfg] = useState({ enabled: false, start_hour: 22, end_hour: 8, mode: 'auto_reply', message: DEFAULT_MSG });
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!initData) return;
    (async () => {
      const r = await fetch('/api/settings/hours', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await r.json();
      if (j.dnd) setCfg(c => ({ ...c, ...j.dnd }));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const r = await fetch('/api/settings/hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(cfg),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setSavedAt(new Date());
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Availability</h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>Your bot replies 24/7 by default — customers are never left waiting.</p>
      </header>

      {/* 24/7 status banner */}
      {!cfg.enabled && (
        <div style={{
          background: `${COLORS.teal}15`, border: `1px solid ${COLORS.teal}40`,
          borderRadius: RADII.lg, padding: '14px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 22 }}>🟢</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.teal }}>Active 24/7</div>
            <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2 }}>
              MiniMe replies to every message instantly, day and night. No customer is left waiting.
            </div>
          </div>
        </div>
      )}

      {/* Enable toggle */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 20, marginBottom: 16, boxShadow: SHADOW.card }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            <Moon size={20} color='#6366F1' />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>Enable quiet hours (optional)</div>
              <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2 }}>During these hours, send a "closed" reply instead of the full AI response</div>
            </div>
          </div>
          {/* Toggle switch */}
          <div
            onClick={() => setCfg(c => ({ ...c, enabled: !c.enabled }))}
            style={{
              width: 44, height: 24, borderRadius: 12,
              background: cfg.enabled ? COLORS.teal : COLORS.border,
              cursor: 'pointer', position: 'relative',
              flexShrink: 0, transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: 3,
              left: cfg.enabled ? 23 : 3,
              width: 18, height: 18, borderRadius: '50%',
              background: '#FFF', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>
      </div>

      {cfg.enabled && (
        <>
          {/* Hours */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 20, marginBottom: 16, boxShadow: SHADOW.card }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.textPrimary, margin: '0 0 12px' }}>Hours</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Quiet from">
                <select value={cfg.start_hour} onChange={e => setCfg(c => ({ ...c, start_hour: Number(e.target.value) }))} style={INPUT_BASE}>
                  {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
                </select>
              </Field>
              <Field label="Quiet until">
                <select value={cfg.end_hour} onChange={e => setCfg(c => ({ ...c, end_hour: Number(e.target.value) }))} style={INPUT_BASE}>
                  {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
                </select>
              </Field>
            </div>
            <p style={{ fontSize: 11, color: COLORS.textHint, margin: '8px 0 0' }}>
              Times are Addis Ababa local. Active when the current hour is between these.
            </p>
          </div>

          {/* Mode */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 20, marginBottom: 16, boxShadow: SHADOW.card }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.textPrimary, margin: '0 0 12px' }}>During quiet hours</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { v: 'auto_reply', icon: '💬', label: 'Auto-reply',  sub: 'Send the message below; flag for follow-up in the morning' },
                { v: 'silent',     icon: '🤫', label: 'Stay silent', sub: "Don't reply at all; you handle it manually later" },
              ].map(o => (
                <button
                  key={o.v}
                  onClick={() => setCfg(c => ({ ...c, mode: o.v }))}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: 12, borderRadius: RADII.md,
                    border: `2px solid ${cfg.mode === o.v ? COLORS.teal : COLORS.border}`,
                    background: cfg.mode === o.v ? COLORS.tealLight : 'transparent',
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    cursor: 'pointer', fontFamily: FONT.body,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{o.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.textPrimary }}>{o.label}</div>
                    <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2 }}>{o.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Auto-reply message */}
          {cfg.mode === 'auto_reply' && (
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 20, marginBottom: 16, boxShadow: SHADOW.card }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.textPrimary, margin: '0 0 12px' }}>Auto-reply message</h2>
              <textarea
                value={cfg.message || ''}
                onChange={e => setCfg(c => ({ ...c, message: e.target.value }))}
                rows={3}
                style={{ ...INPUT_BASE, resize: 'none' }}
              />
            </div>
          )}
        </>
      )}

      {err && (
        <div style={{ background: COLORS.redLight, border: `1px solid ${COLORS.red}40`, borderRadius: RADII.md, padding: '10px 14px', fontSize: 13, color: COLORS.red, marginBottom: 12 }}>
          {err}
        </div>
      )}

      <SaveBar saving={busy} saved={!!savedAt} onSave={save} />
    </div>
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
