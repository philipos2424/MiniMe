'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PRO_FEATURES, PLAN_COMPARISON, PRO_PRICE_LABEL, planStatus } from '../../lib/plan';
import SocialProof from './SocialProof';
import { storyForFeature } from '../../lib/proofStories';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK    = '#0E2823';
const PAPER  = '#FFFFFF';
const CREAM  = '#F4EEE1';
const GOLD   = '#B08A4A';
const GOLDSF = '#D4B987';
const MINT   = '#4FA38A';
const LINE   = '#E4DED1';
const MUTED  = '#8A9590';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

// ─── Upgrade sheet ────────────────────────────────────────────────────────────
// The soft paywall. Opened when a Free owner taps a Pro feature. Leads with the
// specific benefit they just reached for, then Free-vs-Pro, then one tap to the
// existing billing upgrade flow. Always closable — respects the no.
export function UpgradeSheet({ open, onClose, feature }) {
  const router = useRouter();
  if (!open) return null;
  const f = (feature && PRO_FEATURES[feature]) || null;

  function upgrade() {
    onClose?.();
    // Carry the feature through so billing opens the checkout already framed
    // around the thing the owner reached for, instead of dropping them on a
    // generic plan page and making them re-find the CTA.
    router.push(feature ? `/settings/billing?feature=${encodeURIComponent(feature)}` : '/settings/billing');
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(14,40,35,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: PAPER, borderRadius: '24px 24px 0 0', width: '100%', boxSizing: 'border-box',
          padding: '18px 22px 28px', maxHeight: '88%', overflowY: 'auto',
          animation: 'mm-up .28s cubic-bezier(.2,.7,.2,1) both',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 999, background: '#E0D8C6', margin: '0 auto 16px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: GOLD }}>
              MiniMe Pro
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 24, color: INK, marginTop: 3, lineHeight: 1.12 }}>
              {f ? <>Unlock <span style={{ fontStyle: 'italic', color: GOLD }}>{f.label}</span></> : <>Go <span style={{ fontStyle: 'italic', color: GOLD }}>Pro</span></>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: MUTED, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {f && (
          <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start', marginTop: 16, background: CREAM, borderRadius: 14, padding: 15 }}>
            <div style={{ fontSize: 26, lineHeight: 1 }}>{f.emoji}</div>
            <div style={{ fontSize: 13.5, color: '#3A5250', lineHeight: 1.5 }}>{f.pitch}</div>
          </div>
        )}

        {/* A real customer result. Sits right after the feature pitch, where a
            concrete outcome answers "does this actually make me money". */}
        <ProofStory feature={feature} />

        {/* Free vs Pro, row by row */}
        <ComparisonTable />

        {/* The one thing that never changes, said plainly and last so it's the
            thought the owner leaves with. */}
        <div style={{
          marginTop: 12, padding: '10px 13px', borderRadius: 12,
          background: 'rgba(79,163,138,.08)', border: '1px solid rgba(79,163,138,.22)',
          fontSize: 12, color: '#2F5B4E', lineHeight: 1.45, textAlign: 'center',
        }}>
          Staying on Free is fine — MiniMe writes every reply either way. You just press send.
        </div>

        {/* Proof sits immediately above the button — the last thing read
            before the decision. Renders nothing if we can't back it. */}
        <SocialProof style={{ marginTop: 16 }} />

        <button data-intent="billing.upgrade.confirm" onClick={upgrade} style={{
          width: '100%', marginTop: 12, padding: 15, borderRadius: 999, border: 'none',
          background: INK, color: PAPER, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: BODY,
        }}>
          Upgrade to Pro →
        </button>
        {/* Risk reversal, where the thumb actually is. The moment before
            opening Telebirr the thought is "what if this is a waste of 1,999
            birr" — this line is what answers it. */}
        <div style={{ marginTop: 9, fontSize: 11.5, color: MUTED, textAlign: 'center', lineHeight: 1.5 }}>
          Cancel anytime · Telebirr, CBE Birr, Chapa or card<br />
          Your products and chats stay yours if you leave
        </div>

        <button onClick={onClose} style={{
          width: '100%', marginTop: 10, padding: 10, borderRadius: 999, border: 'none',
          background: 'transparent', color: MUTED, fontSize: 13.5, cursor: 'pointer', fontFamily: BODY,
        }}>
          Maybe later
        </button>
      </div>
      <style>{`@keyframes mm-up{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}

// ─── Customer result ──────────────────────────────────────────────────────────
// One shop's real outcome. The "one shop's result" line is not boilerplate:
// a single strong number read as a promise would be deceptive, and saying so
// costs almost nothing while making the claim itself more believable.
export function ProofStory({ feature }) {
  const story = storyForFeature(feature);
  if (!story) return null;

  return (
    <div style={{
      marginTop: 16, padding: '13px 15px', borderRadius: 14,
      background: 'rgba(79,163,138,.07)', border: '1px solid rgba(79,163,138,.22)',
    }}>
      <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.45, fontWeight: 600 }}>
        {story.headline}
      </div>
      {story.detail && (
        <div style={{ fontSize: 12, color: '#4A5E5A', lineHeight: 1.5, marginTop: 5 }}>
          {story.detail}
        </div>
      )}
      {story.oneShop && (
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 7 }}>
          One shop's result — what you earn depends on your own customers.
        </div>
      )}
    </div>
  );
}

// ─── Comparison table ─────────────────────────────────────────────────────────
// Row-per-capability so both plans are read on the same line. The previous
// two-bullet-list layout made the owner diff the columns themselves.
export function ComparisonTable({ compact = false }) {
  const cell = { fontSize: 11.5, lineHeight: 1.3, padding: '9px 8px', verticalAlign: 'middle' };
  return (
    <div style={{ marginTop: compact ? 0 : 18, border: `1px solid ${LINE}`, borderRadius: 14, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: CREAM }}>
            <th style={{ ...cell, textAlign: 'left', width: '48%', fontWeight: 600, color: MUTED, fontSize: 10.5 }} />
            <th style={{ ...cell, textAlign: 'center', color: INK, fontWeight: 700 }}>
              Free
              <div style={{ fontSize: 10, fontWeight: 500, color: MUTED }}>0 ETB</div>
            </th>
            <th style={{ ...cell, textAlign: 'center', color: GOLD, fontWeight: 700 }}>
              Pro
              <div style={{ fontSize: 10, fontWeight: 500, color: GOLD }}>{PRO_PRICE_LABEL}/mo</div>
            </th>
          </tr>
        </thead>
        <tbody>
          {PLAN_COMPARISON.map(row => (
            <tr key={row.label} style={{
              borderTop: `1px solid ${LINE}`,
              // The hero row IS the offer — everything else is supporting
              // detail. Give it the visual weight to match.
              background: row.hero ? 'rgba(176,138,74,.10)' : 'transparent',
            }}>
              <td style={{ ...cell, color: '#3A5250', fontWeight: row.hero ? 700 : 400, fontSize: row.hero ? 12.5 : 11.5 }}>
                {row.label}
              </td>
              <td style={{
                ...cell, textAlign: 'center',
                color: row.free ? '#3A5250' : MUTED,
                fontWeight: row.same || row.hero ? 600 : 400,
                fontSize: row.hero ? 12.5 : 11.5,
              }}>
                {row.free || '—'}
              </td>
              <td style={{
                ...cell, textAlign: 'center', fontWeight: row.hero ? 800 : 600,
                color: '#2F5B4E', fontSize: row.hero ? 12.5 : 11.5,
                // Tint only the rows where Pro actually differs, so the eye
                // lands on what upgrading changes.
                background: row.same ? 'transparent' : 'rgba(176,138,74,.045)',
              }}>
                {row.pro}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ProGate ──────────────────────────────────────────────────────────────────
// Wrap a whole page/section. If the business is Pro (or on trial), renders
// children. Otherwise renders a friendly locked state that opens the sheet.
export function ProGate({ business, feature, children }) {
  const [open, setOpen] = useState(false);
  const { isPro } = planStatus(business);
  if (isPro) return children;
  const f = PRO_FEATURES[feature] || { label: 'this feature', emoji: '🔒', pitch: '' };

  return (
    <div style={{ padding: '32px 22px', textAlign: 'center', fontFamily: BODY, color: INK }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20, margin: '0 auto 18px',
        background: 'rgba(176,138,74,.12)', display: 'grid', placeItems: 'center', fontSize: 34,
      }}>{f.emoji}</div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: GOLD }}>
        MiniMe Pro
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 26, color: INK, marginTop: 6, lineHeight: 1.15 }}>
        {f.label} is a <span style={{ fontStyle: 'italic', color: GOLD }}>Pro</span> feature
      </div>
      <p style={{ fontSize: 14, color: '#4A5E5A', lineHeight: 1.55, margin: '10px auto 22px', maxWidth: 340 }}>
        {f.pitch}
      </p>
      <button data-intent="billing.upgrade.open" onClick={() => setOpen(true)} style={{
        padding: '14px 26px', borderRadius: 999, border: 'none', background: INK, color: PAPER,
        fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: BODY,
      }}>
        See what Pro unlocks →
      </button>
      <UpgradeSheet open={open} onClose={() => setOpen(false)} feature={feature} />
    </div>
  );
}

// ─── ProLock badge ────────────────────────────────────────────────────────────
// A small "PRO" pill for list rows behind the paywall.
export function ProLock() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: 'linear-gradient(135deg, rgba(176,138,74,.18), rgba(212,185,135,.18))',
      color: GOLD, padding: '1px 8px', borderRadius: 999, fontSize: 9.5, fontWeight: 800,
      letterSpacing: '.06em',
    }}>
      ⭐ PRO
    </span>
  );
}
