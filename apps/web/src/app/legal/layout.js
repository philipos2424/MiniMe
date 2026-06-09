import Link from 'next/link';
import { palette, SUPPORT_EMAIL } from './_ui';

export const metadata = {
  title: 'Legal — MiniMe',
  description: 'Privacy Policy, Terms of Service, and other legal documents for MiniMe.',
};

const NAV = [
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/refunds', label: 'Refunds' },
  { href: '/legal/data-deletion', label: 'Data Deletion' },
];

export default function LegalLayout({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: palette.PAPER }}>
      <nav style={{
        borderBottom: `1px solid ${palette.LINE}`, background: 'rgba(251,248,241,0.85)',
        backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{
          maxWidth: 720, margin: '0 auto', padding: '14px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <Link href="/legal" style={{
            fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, color: palette.INK,
            textDecoration: 'none', letterSpacing: '-0.02em',
          }}>
            MiniMe <span style={{ color: palette.FAINT, fontSize: 14 }}>· Legal</span>
          </Link>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {NAV.map(item => (
              <Link key={item.href} href={item.href} style={{
                fontSize: 13.5, color: palette.MUTED, textDecoration: 'none', fontWeight: 500,
              }}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 24px' }}>
        {children}
      </main>

      <footer style={{ borderTop: `1px solid ${palette.LINE}`, marginTop: 24 }}>
        <div style={{
          maxWidth: 720, margin: '0 auto', padding: '24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          fontSize: 13, color: palette.FAINT,
        }}>
          <span>© {new Date().getFullYear()} MiniMe. All rights reserved.</span>
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: palette.MUTED, textDecoration: 'none' }}>
            {SUPPORT_EMAIL}
          </a>
        </div>
      </footer>
    </div>
  );
}
