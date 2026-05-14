'use client';
/**
 * Email Integration settings page.
 * Shows coming-soon cards + waitlist signup form.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

const INTEGRATIONS = [
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '📧',
    desc: 'Connect your Gmail so MiniMe reads new customer emails and drafts replies in your voice.',
    color: '#EA4335',
  },
  {
    id: 'outlook',
    name: 'Outlook / Office 365',
    icon: '📨',
    desc: 'Connect Microsoft Outlook or any Office 365 email account.',
    color: '#0078D4',
  },
  {
    id: 'imap',
    name: 'Custom Email (IMAP)',
    icon: '🔌',
    desc: 'Connect any email server — Yahoo, ProtonMail, or your own domain.',
    color: '#6B7280',
  },
];

const HOW_IT_WORKS = [
  { icon: '📩', step: 'New email arrives', desc: 'MiniMe checks your inbox every few minutes' },
  { icon: '🧠', step: 'AI understands it', desc: 'Reads context, customer history, and what they want' },
  { icon: '✍️', step: 'Draft in your voice', desc: 'Writes a reply exactly how you would' },
  { icon: '✅', step: 'You approve', desc: 'One tap to send — or edit first. You\'re always in control.' },
];

export default function EmailSettingsPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [email, setEmail] = useState('');
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function joinWaitlist() {
    if (!email.trim() || !initData) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/settings/email-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setJoined(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => router.back()} style={{ appearance: 'none', border: 'none', background: 'transparent', fontSize: 22, cursor: 'pointer', color: COLORS.teal, lineHeight: 1, padding: 0 }}>←</button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: COLORS.textPrimary }}>Email Integration</h1>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>Handle customer emails with MiniMe</p>
        </div>
      </div>

      <div style={{ padding: '20px' }}>
        {/* Coming soon banner */}
        <div style={{
          background: `linear-gradient(135deg, ${COLORS.teal}, #0F766E)`,
          borderRadius: RADII.lg, padding: '20px', marginBottom: 24, textAlign: 'center', color: '#FFFFFF',
          boxShadow: '0 8px 32px rgba(13,148,136,0.25)',
        }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📬</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Coming soon</h2>
          <p style={{ fontSize: 14, opacity: 0.85, marginTop: 8, lineHeight: 1.5, maxWidth: 300, margin: '8px auto 0' }}>
            Email integration is in development. Join the waitlist to be first.
          </p>
        </div>

        {/* Waitlist form */}
        {!joined ? (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '18px', boxShadow: SHADOW.card, marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 4 }}>Join the waitlist</div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 14 }}>Be first to know when email integration goes live</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                style={{
                  flex: 1, border: `1px solid ${COLORS.border}`, background: COLORS.bg,
                  borderRadius: RADII.md, padding: '12px 14px', fontSize: 14,
                  fontFamily: FONT.body, color: COLORS.textPrimary, outline: 'none',
                }}
                onFocus={e => e.currentTarget.style.borderColor = COLORS.teal}
                onBlur={e => e.currentTarget.style.borderColor = COLORS.border}
              />
              <button onClick={joinWaitlist} disabled={!email.trim() || busy} style={{
                appearance: 'none', border: 'none', background: COLORS.teal, color: '#FFFFFF',
                borderRadius: RADII.md, padding: '12px 18px', fontSize: 14, fontWeight: 600,
                cursor: email.trim() && !busy ? 'pointer' : 'default', fontFamily: FONT.body,
                opacity: !email.trim() || busy ? 0.7 : 1,
              }}>
                {busy ? '…' : 'Join'}
              </button>
            </div>
            {err && <div style={{ fontSize: 12, color: COLORS.red, marginTop: 8 }}>{err}</div>}
          </div>
        ) : (
          <div style={{ background: COLORS.greenLight, border: `1px solid #BBF7D0`, borderRadius: RADII.lg, padding: '18px', boxShadow: SHADOW.card, marginBottom: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.green }}>You're on the list!</div>
            <div style={{ fontSize: 13, color: COLORS.green, marginTop: 4, opacity: 0.8 }}>We'll notify you as soon as email integration is ready.</div>
          </div>
        )}

        {/* How it will work */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 12 }}>HOW IT WILL WORK</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, overflow: 'hidden', boxShadow: SHADOW.card }}>
            {HOW_IT_WORKS.map((step, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                borderTop: i > 0 ? `1px solid ${COLORS.border}` : 'none',
              }}>
                <span style={{ fontSize: 24, flexShrink: 0 }}>{step.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{step.step}</div>
                  <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Integration cards */}
        <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 12 }}>SUPPORTED PROVIDERS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {INTEGRATIONS.map(intg => (
            <div key={intg.id} style={{
              background: COLORS.surface, border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card,
              display: 'flex', alignItems: 'center', gap: 14, opacity: 0.8,
            }}>
              <span style={{ fontSize: 28, flexShrink: 0 }}>{intg.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{intg.name}</div>
                <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 3, lineHeight: 1.4 }}>{intg.desc}</div>
              </div>
              <span style={{
                fontSize: 10, padding: '4px 10px', borderRadius: 999,
                background: '#F3F4F6', color: COLORS.textHint,
                fontWeight: 600, letterSpacing: '0.04em', flexShrink: 0,
              }}>SOON</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
