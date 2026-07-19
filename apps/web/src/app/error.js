'use client';
import { useEffect } from 'react';

export default function ErrorPage({ error, reset }) {
  useEffect(() => {
    console.error('[Error]', error);
  }, [error]);

  return (
    <div style={{
      minHeight: '100vh', background: '#FFFFFF', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
    }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>⚡</div>
        <h1 style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, fontSize: 28, color: '#0E2823', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 14, color: '#8A9590', lineHeight: 1.5, margin: '0 0 24px' }}>
          An unexpected error occurred. We've been notified and are looking into it.
        </p>
        <button
          onClick={reset}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#0E2823', color: '#FFFFFF', borderRadius: 999,
            padding: '11px 20px', border: 'none', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
