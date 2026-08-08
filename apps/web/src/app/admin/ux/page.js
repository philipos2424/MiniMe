'use client';
/**
 * /admin/ux — standalone deep link to the behavioural usage panel.
 *
 * The panel itself is the 👆 Usage tab of the master admin page; this route
 * exists so it can be linked and bookmarked directly. Both render the same
 * <UxPanel>, so there is one implementation to keep correct.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../context/TelegramContext';
import UxPanel from '../../../components/admin/UxPanel';

const C = { surface: '#FFFFFF', border: '#E4DED1', ink: '#0E2823', muted: '#8A9590' };
const FONT = "'Geist','Inter',-apple-system,system-ui,sans-serif";

export default function UxAnalyticsPage() {
  // Dual auth, identical to /admin/search-analytics: Telegram initData inside
  // the Mini App, otherwise the mm_admin_session cookie set by /admin/login.
  const { initData: telegramInitData, loading: telegramLoading } = useTelegram() || {};
  const [cookieAdmin, setCookieAdmin] = useState(undefined);
  useEffect(() => {
    if (telegramLoading || telegramInitData) return;
    fetch('/api/admin/auth/session')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setCookieAdmin(j?.admin || null))
      .catch(() => setCookieAdmin(null));
  }, [telegramLoading, telegramInitData]);
  const initData = telegramInitData || (cookieAdmin ? 'session' : null);
  const cookieProbeInFlight = !telegramLoading && !telegramInitData && cookieAdmin === undefined;

  const WRAP = { fontFamily: FONT, color: C.ink, padding: '24px 20px 60px', maxWidth: 700 };

  if (telegramLoading || cookieProbeInFlight) return (
    <div style={WRAP}><div style={{ color: C.muted }}>Checking your session…</div></div>
  );
  if (!initData) {
    if (typeof window !== 'undefined') window.location.href = '/admin/login';
    return <div style={WRAP}><div style={{ color: C.muted }}>Taking you to sign in…</div></div>;
  }

  return (
    <div style={WRAP}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <a href="/admin" style={{ fontSize: 12, color: C.muted, textDecoration: 'none', fontWeight: 600 }}>← Master admin</a>
        {!telegramInitData && cookieAdmin && (
          <button
            onClick={() => fetch('/api/admin/auth/logout', { method: 'POST' }).then(() => { window.location.href = '/admin/login'; })}
            style={{ appearance: 'none', border: `1px solid ${C.border}`, background: C.surface, color: C.muted, borderRadius: 8, padding: '5px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
          >Sign out</button>
        )}
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 400, margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces',Georgia,serif" }}>
        👆 Product usage — what owners actually do
      </h1>
      <UxPanel initData={initData} />
    </div>
  );
}
