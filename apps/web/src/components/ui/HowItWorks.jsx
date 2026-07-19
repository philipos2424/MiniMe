'use client';
import { useState } from 'react';

// ─── Shared "How MiniMe works" walkthrough ────────────────────────────────
// A dark-forest, full-screen overlay that answers the single biggest source
// of owner confusion — "what is this thing actually doing for me?" — in eight
// short, accurate beats. Copy is grounded in the Claude Design project
// (MiniMe UX - Redesign / MiniMe Onboarding, walkSteps()), so it stays
// consistent whether it's opened from Home ("How it works"), Settings
// ("Replay walkthrough"), or the onboarding flow itself.
//
// Usage: <HowItWorks open={howOpen} onClose={() => setHowOpen(false)} />

const INK    = '#0E2823';
const CREAM  = '#F4EEE1';
const GOLD   = '#B08A4A';
const GOLDSF = '#D4B987';
const MINT   = '#4FA38A';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const MONO   = "'Geist Mono', ui-monospace, monospace";

// Eight steps — accurate to what MiniMe actually does, no jargon. Each beat
// answers one "wait, what does it do?" question an owner has on day one.
const STEPS = [
  {
    emoji: '📡',
    tint: 'rgba(79,163,138,.16)',
    title: 'Connect your shop, ',
    titleItalic: 'once.',
    body: 'Have a Telegram channel? MiniMe reads your posts and builds your catalog. No channel? Just forward a product photo to your bot — it adds it for you.',
  },
  {
    emoji: '💬',
    tint: 'rgba(212,185,135,.16)',
    title: 'MiniMe answers, ',
    titleItalic: 'instantly.',
    body: 'In your voice, with your exact prices — day and night, so you never miss a sale.',
  },
  {
    emoji: '✨',
    tint: 'rgba(212,185,135,.16)',
    title: 'Give it a ',
    titleItalic: 'personality.',
    body: 'Friendly, formal, or funny — pick a ready-made personality or let MiniMe learn your style from real chats. It replies the way you would, emojis and all.',
  },
  {
    emoji: '✅',
    tint: 'rgba(79,163,138,.16)',
    title: 'You approve the ',
    titleItalic: 'tricky ones.',
    body: 'Anything MiniMe is unsure about lands on your Home as a draft. Send it, or edit first.',
  },
  {
    emoji: '🔎',
    tint: 'rgba(212,185,135,.16)',
    title: 'Customers find you on ',
    titleItalic: 'MiniMe Market.',
    market: true,
    body: 'Shoppers search across MiniMe Market and land on your shop — free exposure, no work.',
  },
  {
    emoji: '🤝',
    tint: 'rgba(79,163,138,.16)',
    title: 'Answer from your ',
    titleItalic: 'own account.',
    body: 'Prefer to reply as yourself? In Telegram: Settings → Business → Chatbots → add @MiniMeAgentBot. Now MiniMe answers customers from your personal Telegram — as you.',
  },
  {
    emoji: '⏸️',
    tint: 'rgba(212,185,135,.16)',
    title: "You're always in ",
    titleItalic: 'control.',
    body: 'MiniMe drafts by default — you decide when it sends on its own. Type /panic in the bot to stop it instantly, anytime.',
  },
  {
    emoji: '📈',
    tint: 'rgba(212,185,135,.16)',
    title: 'Watch sales ',
    titleItalic: 'roll in.',
    body: 'Revenue, orders and hours saved show up on your Home every day. That is it.',
  },
];

export function HowItWorks({ open, onClose, liveShops }) {
  const [step, setStep] = useState(0);
  if (!open) return null;

  const atEnd = step === STEPS.length - 1;
  const s = STEPS[step];
  // Real proof, only when it persuades: append the live shop count to the Market
  // step once there are enough shops to be convincing (mirrors LiveShopsLine).
  const body = (s.market && Number.isFinite(liveShops) && liveShops >= 12)
    ? `${s.body} ${liveShops >= 50 ? `${Math.floor(liveShops / 10) * 10}+` : liveShops} shops are already listed.`
    : s.body;

  function next() {
    if (atEnd) { onClose?.(); setStep(0); return; }
    setStep(v => Math.min(v + 1, STEPS.length - 1));
  }
  function close() {
    onClose?.();
    setStep(0);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: INK, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: BODY,
    }}>
      <div className="grain" />
      <div style={{
        position: 'absolute', top: -70, right: -50, width: 230, height: 230, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212,185,135,.18), transparent 70%)',
      }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'max(22px, env(safe-area-inset-top)) 24px 6px', position: 'relative', zIndex: 2,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: GOLDSF }}>
          How MiniMe works · {step + 1} of {STEPS.length}
        </div>
        <button
          onClick={close}
          style={{
            background: 'rgba(244,238,225,.1)', border: 'none', width: 30, height: 30, borderRadius: '50%',
            color: CREAM, fontSize: 17, cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit',
          }}
        >×</button>
      </div>

      {/* Body */}
      <div className="fade-up" key={step} style={{ flex: 1, overflowY: 'auto', padding: '6px 24px 0', position: 'relative', zIndex: 2 }}>
        <div style={{
          width: 70, height: 70, borderRadius: 20, background: s.tint,
          display: 'grid', placeItems: 'center', fontSize: 34, marginTop: 14,
        }}>{s.emoji}</div>
        <div style={{ fontFamily: SERIF, fontSize: 29, color: CREAM, lineHeight: 1.14, marginTop: 20 }}>
          {s.title}<span style={{ fontStyle: 'italic', color: GOLDSF }}>{s.titleItalic}</span>
        </div>
        <p style={{ fontSize: 15, color: 'rgba(244,238,225,.72)', lineHeight: 1.55, marginTop: 12 }}>
          {body}
        </p>
      </div>

      {/* Footer: progress dots + nav */}
      <div style={{ padding: '20px 24px', paddingBottom: 'max(24px, env(safe-area-inset-bottom))', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {STEPS.map((_, i) => (
            <span key={i} style={{
              height: 4, flex: 1, borderRadius: 999,
              background: i <= step ? GOLD : 'rgba(244,238,225,.16)',
              transition: 'background .2s ease',
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={close}
            style={{
              flex: 1, padding: 14, borderRadius: 999, border: '1px solid rgba(244,238,225,.22)',
              background: 'rgba(244,238,225,.06)', color: CREAM, fontSize: 14, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Skip</button>
          <button
            onClick={next}
            style={{
              flex: 2, padding: 14, borderRadius: 999, border: 'none',
              background: CREAM, color: INK, fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >{atEnd ? "Got it — let's go" : 'Next →'}</button>
        </div>
      </div>
    </div>
  );
}

// Small trigger chip used on Home / Settings — kept here so both call sites
// render the exact same affordance.
export function HowItWorksTrigger({ onClick, variant = 'dark' }) {
  const dark = variant === 'dark';
  return (
    <button
      onClick={onClick}
      style={{
        background: dark ? 'rgba(244,238,225,.12)' : 'transparent',
        color: dark ? CREAM : GOLD,
        border: dark ? '1px solid rgba(244,238,225,.22)' : `1px dashed ${GOLD}`,
        padding: '11px 15px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
        fontFamily: BODY, display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      🧭 How it works
    </button>
  );
}
