import Link from 'next/link';
import { DocTitle, Lead, palette, LAST_UPDATED } from './_ui';

export const metadata = {
  title: 'Legal — MiniMe',
  description: 'Privacy Policy, Terms of Service, Refund Policy, and Data Deletion for MiniMe.',
};

const DOCS = [
  { href: '/legal/privacy', title: 'Privacy Policy', desc: 'What data we collect, how the AI processes it, and your rights.' },
  { href: '/legal/terms', title: 'Terms of Service', desc: 'The rules for using MiniMe, including AI replies and your responsibilities.' },
  { href: '/legal/refunds', title: 'Refund & Cancellation Policy', desc: 'How subscription cancellations and refunds work.' },
  { href: '/legal/data-deletion', title: 'Data Deletion', desc: 'How to delete your account and personal data.' },
];

export default function LegalIndex() {
  return (
    <article>
      <DocTitle updated={LAST_UPDATED}>Legal &amp; Policies</DocTitle>
      <Lead>
        Everything that governs how MiniMe handles your data and how you use the service. If you have any questions,
        reach out — we are happy to help.
      </Lead>

      <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
        {DOCS.map(d => (
          <Link key={d.href} href={d.href} style={{
            display: 'block', textDecoration: 'none',
            background: '#FFFFFF', border: `1px solid ${palette.LINE}`, borderRadius: 14,
            padding: '18px 20px',
          }}>
            <div style={{
              fontFamily: "'Geist', system-ui, sans-serif", fontWeight: 600, fontSize: 16,
              color: palette.INK, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>{d.title}</span>
              <span style={{ color: palette.FAINT, fontWeight: 400 }}>→</span>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: palette.MUTED }}>{d.desc}</div>
          </Link>
        ))}
      </div>
    </article>
  );
}
