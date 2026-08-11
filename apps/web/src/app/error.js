'use client';
import { useEffect } from 'react';

export default function ErrorPage({ error, reset }) {
  useEffect(() => {
    console.error('[Error]', error);
  }, [error]);

  const isAuthError = error?.status === 401 || error?.status === 403 || error?.message?.includes('401') || error?.message?.includes('auth');

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--paper, #0F1612)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: "'Geist', 'Inter', -apple-system, system-ui, sans-serif",
      color: 'var(--ink, #FFFFFF)',
    }}>
      <div style={{
        textAlign: 'center', maxWidth: 360, background: 'var(--card, #16211B)',
        padding: '32px 24px', borderRadius: 20, border: '1px solid var(--line, rgba(255,255,255,0.08))',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
      }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>{isAuthError ? '🔐' : '🌐'}</div>
        <h1 style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 500, fontSize: 24, color: 'var(--ink, #FFFFFF)', margin: '0 0 10px', letterSpacing: '-0.015em' }}>
          {isAuthError ? "We couldn't sign you in" : "Connection issue"}
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted, #9AA39C)', lineHeight: 1.5, margin: '0 0 24px' }}>
          {isAuthError
            ? "Your session may have expired. Please try signing in again."
            : "We couldn't connect. Please check your internet or try again in a moment."}
        </p>
        <button
          onClick={reset}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--mint, #7FD9B3)', color: '#0F1612', borderRadius: 999,
            padding: '10px 24px', border: 'none', fontSize: 13.5, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            transition: 'transform 0.15s ease',
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
