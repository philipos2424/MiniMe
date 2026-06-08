'use client';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', background: '#FBF8F1', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
    }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🗺️</div>
        <h1 style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, fontSize: 28, color: '#0E2823', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          Page not found
        </h1>
        <p style={{ fontSize: 14, color: '#8A9590', lineHeight: 1.5, margin: '0 0 24px' }}>
          This page doesn't exist. You may have followed a broken link or typed the wrong address.
        </p>
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: '#0E2823', color: '#FBF8F1', borderRadius: 999,
          padding: '11px 20px', textDecoration: 'none', fontSize: 14, fontWeight: 600,
        }}>
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
