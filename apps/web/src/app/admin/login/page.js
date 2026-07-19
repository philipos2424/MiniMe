'use client';
/**
 * /admin/login — browser login for the master admin via the official
 * Telegram Login Widget. Only Telegram IDs in ADMIN_TELEGRAM_IDS get a
 * session; everyone else sees "not an admin".
 *
 * Requires (manual setup):
 *  - BotFather /setdomain on the bot behind TELEGRAM_BOT_TOKEN → this domain
 *  - NEXT_PUBLIC_TELEGRAM_BOT_USERNAME env var (widget needs the username)
 *  - ADMIN_SESSION_SECRET env var (cookie signing)
 */
import { useEffect, useRef, useState } from 'react';

const INK = '#0E2823';
const PAPER = '#FFFFFF';
const MUTED = '#8A9590';
const TEAL = '#4FA38A';

export default function AdminLoginPage() {
  const widgetRef = useRef(null);
  const [state, setState] = useState('idle'); // idle | verifying | not_admin | error
  const [errMsg, setErrMsg] = useState('');
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '';

  useEffect(() => {
    // If a valid session already exists, skip the widget entirely.
    fetch('/api/admin/auth/session')
      .then(r => { if (r.ok) window.location.href = '/admin'; })
      .catch(() => {});

    window.onTelegramAuth = async (user) => {
      setState('verifying');
      try {
        const r = await fetch('/api/admin/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { window.location.href = '/admin'; return; }
        if (r.status === 403) { setState('not_admin'); return; }
        setState('error');
        setErrMsg(j.error === 'sessions_not_configured'
          ? 'ADMIN_SESSION_SECRET is not set on the server.'
          : 'Login failed — please try again.');
      } catch {
        setState('error');
        setErrMsg('Network error — please try again.');
      }
    };

    if (botUsername && widgetRef.current && !widgetRef.current.hasChildNodes()) {
      const s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-widget.js?22';
      s.async = true;
      s.setAttribute('data-telegram-login', botUsername);
      s.setAttribute('data-size', 'large');
      s.setAttribute('data-radius', '12');
      s.setAttribute('data-onauth', 'onTelegramAuth(user)');
      s.setAttribute('data-request-access', 'write');
      widgetRef.current.appendChild(s);
    }

    return () => { delete window.onTelegramAuth; };
  }, [botUsername]);

  return (
    <div style={{
      minHeight: '100vh', background: PAPER, color: INK,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Geist', -apple-system, system-ui, sans-serif",
    }}>
      <div style={{
        background: '#fff', border: '1px solid #E4DED1', borderRadius: 20,
        padding: '40px 36px', maxWidth: 380, width: '90%', textAlign: 'center',
        boxShadow: '0 8px 40px -20px rgba(14,40,35,0.25)',
      }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🛡️</div>
        <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 24, fontWeight: 500, margin: '0 0 6px' }}>
          MiniMe Master Admin
        </h1>
        <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 26px', lineHeight: 1.5 }}>
          Sign in with your Telegram account. Only platform admins can enter.
        </p>

        {!botUsername ? (
          <div style={{ fontSize: 13, color: '#B85450', lineHeight: 1.5 }}>
            NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is not configured — the login
            widget can't render. Set it in Vercel env vars and redeploy.
          </div>
        ) : (
          <div ref={widgetRef} style={{ display: 'flex', justifyContent: 'center', minHeight: 48 }} />
        )}

        {state === 'verifying' && (
          <div style={{ fontSize: 13, color: TEAL, marginTop: 16, fontWeight: 600 }}>Verifying…</div>
        )}
        {state === 'not_admin' && (
          <div style={{ fontSize: 13, color: '#B85450', marginTop: 16, lineHeight: 1.5 }}>
            This Telegram account is not an admin. Ask the platform owner to add
            your ID to ADMIN_TELEGRAM_IDS.
          </div>
        )}
        {state === 'error' && (
          <div style={{ fontSize: 13, color: '#B85450', marginTop: 16 }}>{errMsg}</div>
        )}

        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 26, lineHeight: 1.5 }}>
          Inside Telegram? Open the admin from the Mini App — it signs you in automatically.
        </div>
      </div>
    </div>
  );
}
