'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { RELEASE, isWhatsNewVisible } from '../../lib/whatsNew.mjs';

const STORAGE_KEY = 'minime_whats_new_dismissed_v1';
const INK    = 'var(--ink)';
const MINT   = 'var(--mint)';
const MINTSF = 'rgba(46,158,126,.12)';
const MUTED  = 'var(--muted)';
const LINESF = 'var(--line-soft)';

// Dismissal is per device (localStorage), like the other onboarding hints. If
// storage is blocked the card simply shows until the release expires.
export function WhatsNewCard({ business }) {
  const [dismissedId, setDismissedId] = useState(undefined); // undefined = not read yet
  useEffect(() => {
    let id = null;
    try { id = localStorage.getItem(STORAGE_KEY); } catch {}
    setDismissedId(id);
  }, []);

  // Wait for the business so a brand-new shop never flashes a note about changes it never had.
  if (dismissedId === undefined || !business) return null;
  if (!isWhatsNewVisible({ release: RELEASE, dismissedId, businessCreatedAt: business.created_at })) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, RELEASE.id); } catch {}
    setDismissedId(RELEASE.id);
  };

  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{
        background: 'var(--card)', border: `1px solid ${LINESF}`, borderLeft: `3px solid ${MINT}`,
        borderRadius: 14, padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MINT }}>
            What's new
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss what's new"
            style={{ border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', padding: 4, display: 'grid', placeItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {RELEASE.items.map(it => (
            <li key={it.title} style={{ fontSize: 12.5, lineHeight: 1.45, color: MUTED }}>
              <span style={{ color: INK, fontWeight: 650 }}>{it.title}</span> — {it.text}
              {it.href && (
                <>
                  {' '}
                  <Link href={it.href} style={{ color: MINT, fontWeight: 650, textDecoration: 'none', background: MINTSF, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                    {it.cta} →
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={dismiss}
          style={{ marginTop: 12, border: 'none', background: 'transparent', color: MUTED, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
        >
          Got it
        </button>
      </div>
    </section>
  );
}
