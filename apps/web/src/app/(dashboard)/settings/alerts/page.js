'use client';
/**
 * Notifications — what buzzes the owner's Telegram.
 *
 * This lived at the top of Morning Digest, where nobody looked for it. Stored
 * as businesses.notification_prefs.silent_drafts (see notifyOwnerDraft and
 * isImportantForOwner in lib/server/notification.js). Saves on tap.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII } from '../../../../lib/design-tokens';

const SERIF = "'Newsreader', Georgia, serif";

const OPTIONS = [
  { v: false, title: 'Every customer message', desc: 'A Telegram ping for each reply MiniMe drafts.' },
  { v: true, title: 'Only important messages', desc: "When MiniMe isn't sure, a complaint, a scam warning, a customer's first message, a negotiation, or an upset customer. Everything else waits quietly in your MiniMe inbox." },
];

export default function AlertsPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [silent, setSilent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!initData) return;
    fetch('/api/settings/notifications', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => setSilent(j?.silent_drafts === true))
      .catch(() => setSilent(false));
  }, [initData]);

  useEffect(() => {
    const bb = typeof window !== 'undefined' ? window.Telegram?.WebApp?.BackButton : null;
    if (!bb) return;
    const onBack = () => router.push('/settings');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  async function choose(v) {
    if (busy || v === silent) return;
    const prev = silent;
    setSilent(v); setBusy(true); setErr('');
    try {
      const r = await fetch('/api/settings/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ silent_drafts: v }),
      });
      if (!r.ok) throw new Error('save_failed');
    } catch {
      setSilent(prev);
      setErr('Could not save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, padding: '20px 16px 100px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 400, margin: '0 0 8px', letterSpacing: '-0.02em', fontFamily: SERIF }}>Notifications</h1>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '0 0 20px', lineHeight: 1.5 }}>
        Every conversation is always in MiniMe. Choose which ones also ping your Telegram.
      </p>

      <div role="radiogroup" aria-label="What pings me" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {OPTIONS.map(o => {
          const on = silent === o.v;
          return (
            <button key={String(o.v)} type="button" role="radio" aria-checked={on} disabled={busy || silent === null} onClick={() => choose(o.v)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'left',
                padding: '12px 14px', borderRadius: RADII.md, cursor: busy ? 'wait' : 'pointer',
                border: `1.5px solid ${on ? COLORS.ink : COLORS.border}`,
                background: on ? COLORS.cream : COLORS.surface, fontFamily: FONT.body, color: COLORS.textPrimary,
              }}>
              <span aria-hidden style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                border: `2px solid ${on ? COLORS.ink : COLORS.border}`, display: 'grid', placeItems: 'center',
              }}>
                {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.ink }} />}
              </span>
              <span>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{o.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: COLORS.textSecondary, marginTop: 2, lineHeight: 1.45 }}>{o.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {err && <div role="alert" style={{ fontSize: 13, color: COLORS.red, marginBottom: 12 }}>{err}</div>}

      <div style={{ fontSize: 12.5, color: COLORS.textSecondary, lineHeight: 1.6 }}>
        Payment claims and questions MiniMe needs you to answer always ping you, whichever you choose.<br />
        Alerts for replies sent from your personal Telegram are in <Link href="/settings/modes">Secretary Mode</Link>. The daily recap is in <Link href="/settings/notifications">Morning Digest</Link>.
      </div>
    </div>
  );
}
