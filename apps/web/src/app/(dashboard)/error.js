'use client';
/**
 * Page-level error boundary for the Mini App. Renders inside the dashboard
 * layout, so the tab bar stays and one broken page can't blank the whole app.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';

export default function DashboardError({ error, reset }) {
  const router = useRouter();

  useEffect(() => {
    console.error('[DashboardError]', error);
    try { Sentry.captureException(error); } catch {}
  }, [error]);

  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: "'Geist', 'Inter', -apple-system, system-ui, sans-serif", color: 'var(--ink)',
    }}>
      <div style={{
        textAlign: 'center', maxWidth: 360, background: 'var(--card)',
        padding: '28px 24px', borderRadius: 20, border: '1px solid var(--line-soft)',
      }}>
        <h1 style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 500, fontSize: 22, margin: '0 0 8px' }}>
          This page didn&apos;t load
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 20px' }}>
          Your products and chats are safe. Try again, or go back to Settings.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={reset} style={btn('var(--mint)', '#0F1612')}>Try again</button>
          <button onClick={() => router.push('/settings')} style={btn('var(--cream)', 'var(--ink)')}>Settings</button>
        </div>
      </div>
    </div>
  );
}

function btn(background, color) {
  return {
    background, color, border: 'none', borderRadius: 999, padding: '10px 20px',
    fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  };
}
