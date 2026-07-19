'use client';
import { useState, useEffect, useRef } from 'react';

/**
 * First-run onboarding tour — a faithful build of the WALKTHROUGH phase in
 * "MiniMe Onboarding.dc.html" (Claude Design project 1b67b485).
 *
 * Seven beats, each with the design's live demo. Distinct from
 * components/ui/HowItWorks.jsx (the six-step in-app help overlay opened from
 * Home/Settings): this runs BEFORE signup, adds the two secretary beats — the
 * concept ("Meet your secretary") and the six-row Telegram stepper that types
 * the handle itself — and ends on "Create my shop →" rather than "Go to my shop".
 *
 * Flow: welcome splash → [this tour] → sign up → guided home.
 */

const INK    = '#0E2823';
const CREAM  = '#F4EEE1';
const GOLDSF = '#D4B987';
const MINT   = '#4FA38A';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const MONO   = "'Geist Mono', ui-monospace, monospace";

const FAINT   = 'rgba(244,238,225,.72)';
const FAINTER = 'rgba(244,238,225,.5)';
const PANEL   = 'rgba(244,238,225,.05)';
const PANEL_B = 'rgba(244,238,225,.14)';

const STEPS = [
  { emoji: '📡', tint: 'rgba(79,163,138,.16)',  title: 'Connect your shop, ', italic: 'once.',
    body: 'Link your Telegram channel and MiniMe reads every post to build your catalog — no re-typing.' },
  { emoji: '💬', tint: 'rgba(212,185,135,.16)', title: 'MiniMe answers, ', italic: 'instantly.',
    body: 'In your voice, with your exact prices — day and night, so you never miss a sale.' },
  { emoji: '✅', tint: 'rgba(79,163,138,.16)',  title: 'You approve the ', italic: 'tricky ones.',
    body: 'Anything MiniMe is unsure about lands on your Home as a draft. Send it, or edit first.' },
  { emoji: '🔎', tint: 'rgba(212,185,135,.16)', title: 'And customers ', italic: 'find you.',
    body: 'Shoppers search across MiniMe shops and land on yours — free exposure, no work.' },
  { emoji: '🤝', tint: 'rgba(212,185,135,.16)', title: 'Meet your ', italic: 'secretary.' },
  { emoji: '🔗', tint: 'rgba(79,163,138,.16)',  title: 'Connect it in ', italic: 'a few taps.',
    body: "Watch — MiniMe walks you through Telegram's Chat automations:" },
  { emoji: '✨', tint: 'rgba(212,185,135,.16)', title: "That's MiniMe.", italic: '' },
];

const IMPORT_ITEMS = [
  { name: 'Habesha dress',   meta: '1,200 ETB · from post' },
  { name: 'Netela scarf',    meta: '650 ETB · from post' },
  { name: 'Leather sandals', meta: '900 ETB · from post' },
];

const SECRETARY_PERKS = [
  { e: '🌙', t: 'Never leaves a message unread', s: 'Even at 2am, on your personal chats' },
  { e: '🎭', t: 'Sounds exactly like you',       s: 'Your tone, your prices, your rules' },
  { e: '🛡️', t: 'You stay in control',            s: 'Pause or take over any chat, anytime' },
];

const SEC_STEPS = [
  { t: 'Open Telegram → Settings',   s: 'On your business account' },
  { t: 'Tap "Edit profile"',         s: 'Opens your Telegram Business tools' },
  { t: 'Tap "Chat automations"',     s: 'Under Business tools' },
  { t: 'Add the MiniMe bot',         s: 'MiniMe types the handle for you' },
  { t: 'Allow it to reply for you',  s: 'Grant permission to answer chats' },
  { t: 'Connected',                  s: 'MiniMe is now your secretary' },
];

export function OnboardingTour({ onFinish, onSkip }) {
  const [step, setStep] = useState(0);
  const [importStage, setImportStage] = useState('connecting');
  const [secStage, setSecStage] = useState(0);
  const [secTyped, setSecTyped] = useState('');
  const timers = useRef([]);

  function clearTimers() { timers.current.forEach(clearTimeout); timers.current = []; }

  useEffect(() => {
    clearTimers();
    if (step === 0) {
      setImportStage('connecting');
      timers.current.push(setTimeout(() => setImportStage('found'), 1100));
    } else if (step === 5) {
      // Staged walk down the Telegram stepper, typing the handle at row 4.
      setSecStage(0); setSecTyped('');
      timers.current.push(setTimeout(() => setSecStage(1), 700));
      timers.current.push(setTimeout(() => setSecStage(2), 1400));
      timers.current.push(setTimeout(() => {
        setSecStage(3);
        const full = 'minimeagentbot';
        let i = 0;
        const tick = () => {
          i += 1;
          setSecTyped(full.slice(0, i));
          if (i < full.length) timers.current.push(setTimeout(tick, 85));
          else {
            timers.current.push(setTimeout(() => setSecStage(4), 550));
            timers.current.push(setTimeout(() => setSecStage(5), 1500));
            timers.current.push(setTimeout(() => setSecStage(6), 2600));
          }
        };
        timers.current.push(setTimeout(tick, 300));
      }, 2100));
    }
    return clearTimers;
  }, [step]);

  useEffect(() => () => clearTimers(), []);

  const atEnd = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300, background: INK,
      display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: BODY,
    }}>
      <div className="grain" />
      <div style={{
        position: 'absolute', top: -70, right: -50, width: 230, height: 230, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212,185,135,.16), transparent 70%)',
      }} />

      {/* Header — mark + step count + Skip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'max(20px, env(safe-area-inset-top)) 24px 6px', position: 'relative', zIndex: 2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <svg width="22" height="22" viewBox="0 0 100 100" fill="none">
            <path d="M18 50 Q18 22 34 22 Q50 22 50 50 Q50 22 66 22 Q82 22 82 50" stroke={CREAM} strokeWidth="7" strokeLinecap="round" />
            <line x1="16" y1="50" x2="84" y2="50" stroke={GOLDSF} strokeWidth="4" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: GOLDSF }}>
            {step + 1} of {STEPS.length}
          </div>
        </div>
        <button onClick={onSkip} style={{
          background: 'rgba(244,238,225,.1)', border: 'none', padding: '5px 12px', borderRadius: 999,
          color: 'rgba(244,238,225,.75)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>Skip</button>
      </div>

      {/* Body */}
      <div className="fade-up" key={step} style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        padding: '6px 24px 0', position: 'relative', zIndex: 2, minHeight: 0,
      }}>
        {atEnd ? (
          <ReadyPanel s={s} />
        ) : (
          <>
            <div style={{
              width: 70, height: 70, borderRadius: 20, background: s.tint,
              display: 'grid', placeItems: 'center', fontSize: 34, marginTop: 12,
            }}>{s.emoji}</div>
            <div style={{ fontFamily: SERIF, fontSize: 30, color: CREAM, lineHeight: 1.14, marginTop: step === 5 ? 18 : 20 }}>
              {s.title}<span style={{ fontStyle: 'italic', color: GOLDSF }}>{s.italic}</span>
            </div>
            {step === 4 ? (
              <p style={{ fontSize: 15, color: FAINT, lineHeight: 1.55, marginTop: 12 }}>
                So far MiniMe replies as your <em>shop bot</em>. The secretary goes further — it answers right from{' '}
                <strong style={{ color: CREAM }}>your own Telegram account</strong>, so customers who message you
                directly still get an instant reply.
              </p>
            ) : (
              <p style={{ fontSize: step === 5 ? 14 : 15, color: step === 5 ? 'rgba(244,238,225,.7)' : FAINT, lineHeight: 1.5, marginTop: step === 5 ? 10 : 12 }}>
                {s.body}
              </p>
            )}

            {step === 0 && <ImportDemo stage={importStage} />}
            {step === 1 && <ChatDemo />}
            {step === 2 && <DraftDemo />}
            {step === 3 && <SearchDemo />}
            {step === 4 && <SecretaryPerks />}
            {step === 5 && <SecretaryStepper stage={secStage} typed={secTyped} />}
          </>
        )}
        <div style={{ height: 16 }} />
      </div>

      {/* Footer — 7 dots + Back / Next / Create my shop */}
      <div style={{ padding: '14px 24px', paddingBottom: 'max(24px, env(safe-area-inset-bottom))', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', gap: 5, marginBottom: 16 }}>
          {STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} aria-label={`Step ${i + 1}`} style={{
              height: 5, flex: 1, borderRadius: 999, border: 'none', padding: 0, cursor: 'pointer',
              background: i <= step ? CREAM : 'rgba(244,238,225,.2)', transition: 'background .2s ease',
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 0 && (
            <button onClick={() => setStep(v => v - 1)} style={{
              padding: '15px 22px', borderRadius: 999, border: '1px solid rgba(244,238,225,.2)',
              background: 'transparent', color: CREAM, fontSize: 14, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>Back</button>
          )}
          <button
            onClick={() => (atEnd ? onFinish?.() : setStep(v => v + 1))}
            style={{
              flex: 2, padding: 16, borderRadius: 999, border: 'none',
              background: atEnd ? GOLDSF : CREAM, color: INK,
              fontSize: 15, fontWeight: atEnd ? 700 : 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >{atEnd ? 'Create my shop →' : 'Next →'}</button>
        </div>
      </div>
      <TourKeyframes />
    </div>
  );
}

// ── S0 ─ channel connects, products appear ───────────────────────────────────
function ImportDemo({ stage }) {
  const found = stage === 'found';
  return (
    <div style={{ marginTop: 22, background: PANEL, border: `1px solid ${PANEL_B}`, borderRadius: 20, padding: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12,
        border: `1.5px solid ${found ? MINT : GOLDSF}`, background: 'rgba(244,238,225,.04)',
        transition: 'border-color .3s ease',
      }}>
        <span style={{ color: FAINTER, fontFamily: MONO, fontSize: 13.5 }}>t.me/</span>
        <span style={{ flex: 1, fontFamily: MONO, fontSize: 13.5, color: CREAM }}>selamboutique</span>
        {found ? (
          <span style={{ background: MINT, color: '#fff', fontSize: 11, fontWeight: 600, padding: '6px 13px', borderRadius: 999, animation: 'ob-bub .35s both' }}>Connected</span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'rgba(244,238,225,.6)' }}>
            <span style={{ width: 12, height: 12, border: '2px solid rgba(244,238,225,.25)', borderTopColor: GOLDSF, borderRadius: '50%', animation: 'ob-spin .7s linear infinite' }} />
            Connecting
          </span>
        )}
      </div>
      {found && (
        <div>
          <div style={{ fontSize: 11.5, color: '#8FC7B0', margin: '13px 0 4px', fontWeight: 600 }}>
            Found 3 posts — created 3 products.
          </div>
          {IMPORT_ITEMS.map((it, i) => (
            <div key={it.name} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0',
              borderTop: '1px solid rgba(244,238,225,.1)', animation: `ob-bub .45s ${0.05 + i * 0.15}s both`,
            }}>
              <span style={{ fontSize: 17 }}>📦</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: CREAM }}>{it.name}</div>
                <div style={{ fontSize: 11, color: FAINTER }}>{it.meta}</div>
              </div>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: MINT, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11 }}>✓</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── S1 ─ a real exchange ─────────────────────────────────────────────────────
function ChatDemo() {
  return (
    <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ alignSelf: 'flex-start', maxWidth: '78%', background: 'rgba(244,238,225,.08)', color: CREAM, padding: '11px 14px', borderRadius: '16px 16px 16px 4px', fontSize: 13.5, lineHeight: 1.45, animation: 'ob-bub .4s .1s both' }}>
        Is the habesha dress still available?
      </div>
      <div style={{ alignSelf: 'flex-end', maxWidth: '80%', background: CREAM, color: INK, padding: '11px 14px', borderRadius: '16px 16px 4px 16px', fontSize: 13.5, lineHeight: 1.45, animation: 'ob-bub .4s .5s both' }}>
        Yes! It&apos;s 1,200 ETB in red or cream. Want me to hold one for you? 😊
      </div>
      <div style={{ alignSelf: 'flex-end', fontSize: 10, color: 'rgba(244,238,225,.4)', animation: 'ob-bub .4s .7s both' }}>
        MiniMe · replied in 3s
      </div>
    </div>
  );
}

// ── S2 ─ the approval moment ─────────────────────────────────────────────────
function DraftDemo() {
  return (
    <div style={{ marginTop: 22, background: PANEL, border: `1px solid ${PANEL_B}`, borderRadius: 18, padding: 16, animation: 'ob-bub .4s .15s both' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: GOLDSF, letterSpacing: '.12em', marginBottom: 6 }}>
        MINIME&apos;S DRAFT · NEEDS YOU
      </div>
      <div style={{ fontSize: 13.5, color: CREAM, lineHeight: 1.45 }}>
        I can offer 10% off if you order two today — shall I set it up?
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 13 }}>
        <div style={{ flex: 2, background: MINT, color: '#fff', padding: 10, borderRadius: 11, fontSize: 13, fontWeight: 600, textAlign: 'center' }}>✓ Send</div>
        <div style={{ flex: 1, border: '1px solid rgba(244,238,225,.2)', color: CREAM, padding: 10, borderRadius: 11, fontSize: 13, textAlign: 'center' }}>Edit</div>
      </div>
    </div>
  );
}

// ── S3 ─ their shop as the top result ────────────────────────────────────────
function SearchDemo() {
  return (
    <>
      <div style={{ marginTop: 22, background: '#fff', borderRadius: 16, padding: 14, animation: 'ob-bub .4s .15s both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', background: '#F2ECE1', borderRadius: 10 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A9590" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <span style={{ fontSize: 12.5, color: '#8A9590' }}>habesha dress</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 4px 4px' }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: '#E8D3A6', display: 'grid', placeItems: 'center', fontSize: 17 }}>👗</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>Selam Boutique</div>
            <div style={{ fontSize: 11, color: '#8A9590' }}>Habesha dress · 1,200 ETB</div>
          </div>
          <span style={{ background: 'rgba(79,163,138,.14)', color: '#3C8E77', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>Top result</span>
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', background: PANEL, border: `1px solid ${PANEL_B}`, borderRadius: 14, animation: 'ob-bub .4s .3s both' }}>
        <span style={{ fontSize: 16 }}>🌍</span>
        <div style={{ fontSize: 12, color: FAINT, lineHeight: 1.4 }}>
          Auto-listed on <span style={{ fontFamily: MONO, color: GOLDSF }}>@MiniMeSearchBot</span>
        </div>
      </div>
    </>
  );
}

// ── S4 ─ why a secretary is different from the shop bot ──────────────────────
function SecretaryPerks() {
  return (
    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {SECRETARY_PERKS.map((p, i) => (
        <div key={p.t} style={{
          display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 14px',
          background: PANEL, border: '1px solid rgba(244,238,225,.12)', borderRadius: 14,
          animation: `ob-bub .4s ${0.1 + i * 0.15}s both`,
        }}>
          <span style={{ fontSize: 19 }}>{p.e}</span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: CREAM }}>{p.t}</div>
            <div style={{ fontSize: 12, color: 'rgba(244,238,225,.55)', marginTop: 2 }}>{p.s}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── S5 ─ the exact Telegram path, walked automatically ───────────────────────
function SecretaryStepper({ stage, typed }) {
  return (
    <>
      <div style={{ marginTop: 18, background: PANEL, border: `1px solid ${PANEL_B}`, borderRadius: 18, padding: '16px 16px 8px' }}>
        {SEC_STEPS.map((row, i) => {
          const last = i === SEC_STEPS.length - 1;
          const state = last
            ? (stage >= 6 ? 'done' : stage === 5 ? 'active' : 'pending')
            : (stage > i ? 'done' : stage === i ? 'active' : 'pending');
          const done = state === 'done';
          const active = state === 'active';
          const spin = last && stage === 5;
          return (
            <div key={row.t} style={{ display: 'flex', gap: 13, paddingBottom: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: done ? MINT : active ? 'rgba(212,185,135,.16)' : 'rgba(244,238,225,.04)',
                  border: `1.5px solid ${done ? MINT : active ? GOLDSF : 'rgba(244,238,225,.18)'}`,
                  display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
                  color: done ? '#fff' : active ? GOLDSF : 'rgba(244,238,225,.4)',
                  transition: 'all .3s ease',
                }}>
                  {spin
                    ? <span style={{ width: 12, height: 12, border: '2px solid rgba(212,185,135,.3)', borderTopColor: GOLDSF, borderRadius: '50%', animation: 'ob-spin .7s linear infinite' }} />
                    : (done ? '✓' : String(i + 1))}
                </div>
                {!last && <div style={{ width: 1.5, flex: 1, minHeight: 12, background: done ? 'rgba(79,163,138,.4)' : 'rgba(244,238,225,.12)' }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: 4 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: (done || active) ? CREAM : 'rgba(244,238,225,.45)' }}>{row.t}</div>
                <div style={{ fontSize: 11.5, color: active ? 'rgba(244,238,225,.62)' : 'rgba(244,238,225,.32)', marginTop: 2 }}>{row.s}</div>
                {i === 3 && stage >= 3 && (
                  <div style={{
                    marginTop: 9, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
                    borderRadius: 10, border: `1.5px solid ${GOLDSF}`, background: 'rgba(244,238,225,.04)',
                  }}>
                    <span style={{ color: FAINTER, fontFamily: MONO, fontSize: 13 }}>@</span>
                    <span style={{ flex: 1, fontFamily: MONO, fontSize: 13, color: CREAM }}>
                      {typed}
                      {stage === 3 && <span style={{ display: 'inline-block', width: 2, height: 14, background: GOLDSF, verticalAlign: -2, animation: 'ob-blink 1s step-end infinite' }} />}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {stage >= 6 && (
        <div style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px',
          borderRadius: 14, background: 'rgba(79,163,138,.16)', border: '1px solid rgba(79,163,138,.4)',
          animation: 'ob-bub .45s both',
        }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', background: MINT, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 13 }}>✓</span>
          <div style={{ fontSize: 13, color: '#8FC7B0', fontWeight: 600, lineHeight: 1.35 }}>
            Secretary connected — MiniMe now replies from your account.
          </div>
        </div>
      )}
    </>
  );
}

// ── S6 ─ the close ───────────────────────────────────────────────────────────
function ReadyPanel({ s }) {
  return (
    <div style={{ textAlign: 'center', paddingTop: 16 }}>
      <div style={{
        width: 84, height: 84, borderRadius: 24, background: s.tint,
        display: 'grid', placeItems: 'center', fontSize: 42, margin: '0 auto', animation: 'ob-pop .5s both',
      }}>{s.emoji}</div>
      <div style={{ fontFamily: SERIF, fontSize: 32, color: CREAM, lineHeight: 1.14, marginTop: 22 }}>
        That&apos;s MiniMe.
      </div>
      <p style={{ fontSize: 15, color: FAINT, lineHeight: 1.55, marginTop: 12, maxWidth: 290, marginLeft: 'auto', marginRight: 'auto' }}>
        Answers customers, takes orders and runs your shop — around the clock. Ready to make it yours?
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 26 }}>
        {[['24/7', 'always on'], ['3s', 'avg reply'], ['0', 'missed sales']].map(([n, l], i) => (
          <div key={n} style={{ display: 'flex', gap: 22 }}>
            {i > 0 && <div style={{ width: 1, background: 'rgba(244,238,225,.14)' }} />}
            <div>
              <div style={{ fontFamily: SERIF, fontSize: 26, color: GOLDSF }}>{n}</div>
              <div style={{ fontSize: 10.5, color: FAINTER, marginTop: 2 }}>{l}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourKeyframes() {
  return (
    <style>{`
      @keyframes ob-spin { to { transform: rotate(360deg); } }
      @keyframes ob-blink { 50% { opacity: 0; } }
      @keyframes ob-pop { from { opacity:0; transform:scale(.8);} to { opacity:1; transform:scale(1);} }
      @keyframes ob-bub { from { opacity:0; transform:translateY(8px) scale(.97);} to { opacity:1; transform:none;} }
    `}</style>
  );
}
