'use client';
import { useState, useEffect } from 'react';

/**
 * First-run coach tour — plays ON the real Home screen right after signup.
 *
 * This is distinct from HowItWorks (the pre-signup "what does MiniMe do"
 * carousel): HowItWorks sells the concept before an owner has a shop; this
 * orients them inside their ACTUAL Home the moment it goes live, per the
 * Claude Design project's "GUIDED HOME (first run)" screen — a welcome beat
 * ("Your shop is live, {name}.") then a short tour of the three things that
 * matter (the focus card, the manage list, settings/advisor), plus a floating
 * "↺ Replay tour" affordance. Building this was the gap left from the last
 * redesign pass — HowItWorks covered the concept, this covers the real page.
 *
 * Shows once automatically (localStorage flag, same pattern as the existing
 * first-sale banner in DashboardPage.jsx), replayable anytime via the pill.
 */

const INK    = '#0E2823';
const CREAM  = '#F4EEE1';
const GOLD   = '#B08A4A';
const GOLDSF = '#D4B987';
const MINT   = '#4FA38A';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const SEEN_KEY = 'mm_home_coach_v1';

const TIPS = [
  {
    kicker: '1 of 3',
    title: 'Do this next',
    body: 'When customers message you, MiniMe drafts a reply here. Read it, then Send or Edit — one tap either way.',
  },
  {
    kicker: '2 of 3',
    title: 'Manage your shop',
    body: 'Products, Broadcast, Customers, Analytics, Files — everything you run day to day lives in this one list.',
  },
  {
    kicker: '3 of 3',
    title: 'Settings & Advisor',
    body: 'Settings is where you teach MiniMe your voice and rules. Tap Advisor anytime to ask it business questions.',
  },
];

export function useHomeCoach() {
  const [open, setOpen] = useState(false);

  // Auto-open once, after paint, so it never blocks the first render.
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch { /* localStorage unavailable — just skip the auto-tour */ }
  }, []);

  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
  }

  return {
    open,
    start: () => setOpen(true),
    close: () => { markSeen(); setOpen(false); },
  };
}

export function HomeCoach({ open, onClose, shopName }) {
  const [step, setStep] = useState(-1); // -1 = welcome beat, 0..2 = tips

  useEffect(() => { if (open) setStep(-1); }, [open]);

  if (!open) return null;

  const atWelcome = step === -1;
  const tip = !atWelcome ? TIPS[step] : null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: atWelcome ? 'rgba(8,24,20,.78)' : 'transparent',
      backdropFilter: atWelcome ? 'blur(2px)' : 'none',
      display: 'flex', alignItems: atWelcome ? 'center' : 'flex-end',
      justifyContent: 'center', padding: atWelcome ? 34 : '0 20px 96px',
      fontFamily: BODY, pointerEvents: 'auto',
    }}>
      {atWelcome ? (
        <div style={{ textAlign: 'center', maxWidth: 290 }} className="fade-up">
          <div style={{
            width: 84, height: 84, borderRadius: '50%', margin: '0 auto',
            background: 'rgba(79,163,138,.18)', display: 'grid', placeItems: 'center',
          }}>
            <span style={{
              width: 54, height: 54, borderRadius: '50%', background: MINT,
              display: 'grid', placeItems: 'center', color: '#fff', fontSize: 26,
            }}>✓</span>
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 27, color: CREAM, marginTop: 20, lineHeight: 1.2 }}>
            Your shop is live{shopName ? `, ${shopName}` : ''}.
          </div>
          <p style={{ fontSize: 13.5, color: 'rgba(244,238,225,.72)', lineHeight: 1.55, marginTop: 9 }}>
            MiniMe is already watching your chats. Let me show you the 3 things that matter — takes 15 seconds.
          </p>
          <button onClick={() => setStep(0)} style={{
            marginTop: 22, background: GOLDSF, color: INK, border: 'none',
            padding: '14px 30px', borderRadius: 999, fontSize: 14.5, fontWeight: 700,
            cursor: 'pointer', fontFamily: BODY,
          }}>
            Show me around →
          </button>
          <button onClick={onClose} style={{
            display: 'block', margin: '11px auto 0', background: 'none', border: 'none',
            color: 'rgba(244,238,225,.5)', fontSize: 12.5, cursor: 'pointer', fontFamily: BODY,
          }}>
            Skip, I'll explore
          </button>
        </div>
      ) : (
        <div className="fade-up" style={{
          width: '100%', maxWidth: 360, background: CREAM, borderRadius: 18,
          padding: '17px 18px', boxShadow: '0 22px 50px -14px rgba(0,0,0,.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', background: INK, color: GOLDSF,
              display: 'grid', placeItems: 'center', fontFamily: SERIF, fontStyle: 'italic', fontSize: 12,
            }}>m</div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#9AA39E' }}>
              {tip.kicker}
            </div>
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 19, color: INK, marginTop: 9, lineHeight: 1.22 }}>{tip.title}</div>
          <p style={{ fontSize: 13, color: '#4A5E5A', lineHeight: 1.5, margin: '7px 0 0' }}>{tip.body}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 15 }}>
            <button
              onClick={() => (step < TIPS.length - 1 ? setStep(s => s + 1) : onClose())}
              style={{
                background: INK, color: CREAM, border: 'none', padding: '9px 20px',
                borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: BODY,
              }}
            >
              {step < TIPS.length - 1 ? 'Next →' : 'Got it'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Small floating "↺ Replay tour" pill — matches the design's coachDone state.
 * Stacked ABOVE the Feedback FAB (DashboardShell.jsx:207, same right:14/
 * bottom:84+safe-area corner) so the two never overlap.
 */
export function ReplayTourPill({ onClick }) {
  return (
    <button onClick={onClick} style={{
      position: 'fixed', right: 14, bottom: 'calc(134px + env(safe-area-inset-bottom))', zIndex: 60,
      background: 'rgba(14,40,35,.9)', border: 'none', color: CREAM,
      fontSize: 11.5, fontWeight: 600, padding: '8px 14px', borderRadius: 999,
      cursor: 'pointer', fontFamily: BODY, boxShadow: '0 8px 20px -8px rgba(0,0,0,.5)',
    }}>
      ↺ Replay tour
    </button>
  );
}
