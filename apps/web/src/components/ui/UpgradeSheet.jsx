'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PRO_FEATURES, PRO_BENEFITS, FREE_BENEFITS, planStatus } from '../../lib/plan';

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
    router.push('/settings/billing');
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

        {/* Free vs Pro */}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <PlanColumn name="Free" price="0 ETB" benefits={FREE_BENEFITS} accent={MUTED} />
          <PlanColumn name="Pro" price="2,500 ETB/mo" benefits={PRO_BENEFITS} accent={GOLD} highlight />
        </div>

        <button onClick={upgrade} style={{
          width: '100%', marginTop: 18, padding: 15, borderRadius: 999, border: 'none',
          background: INK, color: PAPER, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: BODY,
        }}>
          Upgrade to Pro →
        </button>
        <button onClick={onClose} style={{
          width: '100%', marginTop: 8, padding: 10, borderRadius: 999, border: 'none',
          background: 'transparent', color: MUTED, fontSize: 13.5, cursor: 'pointer', fontFamily: BODY,
        }}>
          Maybe later
        </button>
      </div>
      <style>{`@keyframes mm-up{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}

function PlanColumn({ name, price, benefits, accent, highlight }) {
  return (
    <div style={{
      flex: 1, border: `1.5px solid ${highlight ? GOLD : LINE}`, borderRadius: 14,
      padding: '14px 13px', background: highlight ? 'rgba(176,138,74,.05)' : '#fff',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{name}</div>
      <div style={{ fontSize: 12, color: accent, fontWeight: 600, marginTop: 2, marginBottom: 10 }}>{price}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {benefits.map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: '#3A5250', lineHeight: 1.35 }}>
            <span style={{ color: highlight ? MINT : MUTED, flexShrink: 0 }}>{highlight ? '✓' : '•'}</span>
            <span>{b}</span>
          </div>
        ))}
      </div>
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
      <button onClick={() => setOpen(true)} style={{
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
