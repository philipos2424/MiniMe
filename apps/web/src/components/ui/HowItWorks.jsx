'use client';
import { useState, useEffect, useRef } from 'react';

// ─── "How MiniMe works" walkthrough ───────────────────────────────────────────
// A faithful implementation of the walkthrough in the Claude Design project
// (MiniMe UX - Redesign.dc.html). Six beats, each with a LIVE VISUAL DEMO —
// the demo is the point: an owner sees the channel import actually run, sees a
// reply get drafted, sees themselves show up in search. Text alone left the
// screen looking empty and taught nothing.
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

const FAINT   = 'rgba(244,238,225,.72)';
const FAINTER = 'rgba(244,238,225,.5)';
const PANEL   = 'rgba(244,238,225,.05)';
const PANEL_B = 'rgba(244,238,225,.14)';

const STEPS = [
  { emoji: '📡', tint: 'rgba(79,163,138,.16)',  title: 'Connect your shop, ', italic: 'once.',
    body: 'Link your Telegram channel and MiniMe reads every post to build your catalog — no re-typing. No channel? Forward a product photo to your bot instead.' },
  { emoji: '💬', tint: 'rgba(212,185,135,.16)', title: 'MiniMe answers, ', italic: 'instantly.',
    body: 'In your voice, with your exact prices — day and night, so you never miss a sale.' },
  { emoji: '✅', tint: 'rgba(79,163,138,.16)',  title: 'You approve the ', italic: 'tricky ones.',
    body: 'Anything MiniMe is unsure about lands on your Home as a draft. Send it, or edit first.' },
  { emoji: '🔎', tint: 'rgba(212,185,135,.16)', title: 'And customers ', italic: 'find you.',
    body: 'Shoppers search across MiniMe shops and land on yours — free exposure, no work.', market: true },
  { emoji: '🤝', tint: 'rgba(79,163,138,.16)',  title: 'Add your ', italic: 'secretary.',
    body: 'Add MiniMe to your Telegram chat automations so it can reply from your own account — as you.' },
  { emoji: '🎉', tint: 'rgba(79,163,138,.16)',  title: "You're all ", italic: 'set.',
    body: 'MiniMe is now watching your shop. Sales, orders and hours saved will show on your Home every day.' },
];

const IMPORT_ITEMS = [
  { name: 'Habesha dress', meta: '1,200 ETB · 2 colours' },
  { name: 'Leather tote',  meta: '3,200 ETB' },
  { name: 'Netela scarf',  meta: '850 ETB' },
];

export function HowItWorks({ open, onClose, liveShops }) {
  const [step, setStep] = useState(0);
  // S0 channel-import demo: 'connecting' → 'found'
  const [importStage, setImportStage] = useState('connecting');
  // S4 secretary demo: types the handle, then connects
  const [typed, setTyped] = useState('');
  const [botStage, setBotStage] = useState('typing');
  const timers = useRef([]);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  // Drive the per-step animations. Re-runs whenever the visible step changes so
  // stepping back and forth replays the demo rather than showing a dead frame.
  useEffect(() => {
    clearTimers();
    if (!open) return;

    if (step === 0) {
      setImportStage('connecting');
      timers.current.push(setTimeout(() => setImportStage('found'), 1100));
    } else if (step === 4) {
      setTyped('');
      setBotStage('typing');
      const full = 'minimeagentbot';
      let i = 0;
      const tick = () => {
        i += 1;
        setTyped(full.slice(0, i));
        if (i < full.length) timers.current.push(setTimeout(tick, 90));
        else {
          timers.current.push(setTimeout(() => setBotStage('connecting'), 450));
          timers.current.push(setTimeout(() => setBotStage('done'), 1450));
        }
      };
      timers.current.push(setTimeout(tick, 550));
    }
    return clearTimers;
  }, [step, open]);

  useEffect(() => () => clearTimers(), []);

  if (!open) return null;

  const atEnd = step === STEPS.length - 1;
  const s = STEPS[step];
  // Real proof, only when it persuades (mirrors LiveShopsLine's threshold).
  const body = (s.market && Number.isFinite(liveShops) && liveShops >= 12)
    ? `${s.body} ${liveShops >= 50 ? `${Math.floor(liveShops / 10) * 10}+` : liveShops} shops are already listed.`
    : s.body;

  function close() { clearTimers(); onClose?.(); setStep(0); }
  function next()  { atEnd ? close() : setStep(v => v + 1); }
  function back()  { setStep(v => Math.max(0, v - 1)); }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200, background: INK,
      display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: BODY,
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
        <button onClick={close} style={{
          background: 'rgba(244,238,225,.1)', border: 'none', width: 30, height: 30, borderRadius: '50%',
          color: CREAM, fontSize: 17, cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit',
        }}>×</button>
      </div>

      {/* Body */}
      <div className="fade-up" key={step} style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        padding: '6px 24px 0', position: 'relative', zIndex: 2, minHeight: 0,
      }}>
        {atEnd ? (
          <ReadyPanel s={s} body={body} />
        ) : (
          <>
            <div style={{
              width: 70, height: 70, borderRadius: 20, background: s.tint,
              display: 'grid', placeItems: 'center', fontSize: 34, marginTop: 14,
            }}>{s.emoji}</div>
            <div style={{ fontFamily: SERIF, fontSize: 29, color: CREAM, lineHeight: 1.14, marginTop: 20 }}>
              {s.title}<span style={{ fontStyle: 'italic', color: GOLDSF }}>{s.italic}</span>
            </div>
            <p style={{ fontSize: 15, color: FAINT, lineHeight: 1.55, marginTop: 12 }}>{body}</p>

            {step === 0 && <ImportDemo stage={importStage} />}
            {step === 1 && <ChatDemo />}
            {step === 2 && <DraftDemo />}
            {step === 3 && <SearchDemo />}
            {step === 4 && <SecretaryDemo typed={typed} stage={botStage} />}
          </>
        )}
        <div style={{ height: 16 }} />
      </div>

      {/* Footer: dots + nav */}
      <div style={{ padding: '18px 24px', paddingBottom: 'max(24px, env(safe-area-inset-bottom))', position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} aria-label={`Step ${i + 1}`} style={{
              height: 5, flex: 1, borderRadius: 999, border: 'none', padding: 0, cursor: 'pointer',
              background: i <= step ? GOLD : 'rgba(244,238,225,.16)', transition: 'background .2s ease',
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 0 && (
            <button onClick={back} style={{
              padding: '15px 22px', borderRadius: 999, border: '1px solid rgba(244,238,225,.2)',
              background: 'transparent', color: CREAM, fontSize: 14, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>Back</button>
          )}
          {!atEnd && (
            <button onClick={close} style={{
              flex: 1, padding: 15, borderRadius: 999, border: '1px solid rgba(244,238,225,.2)',
              background: 'transparent', color: 'rgba(244,238,225,.7)', fontSize: 14, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>Skip</button>
          )}
          <button onClick={next} style={{
            flex: 2, padding: 15, borderRadius: 999, border: 'none',
            background: atEnd ? GOLDSF : CREAM, color: INK,
            fontSize: 14.5, fontWeight: atEnd ? 700 : 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{atEnd ? 'Go to my shop →' : 'Next →'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Step demos ───────────────────────────────────────────────────────────────

// S0 — the channel connecting, then products appearing. Shows the single most
// valuable thing MiniMe does: fill a catalog without typing.
function ImportDemo({ stage }) {
  const found = stage === 'found';
  return (
    <div style={{ marginTop: 22, background: PANEL, border: `1px solid ${PANEL_B}`, borderRadius: 20, padding: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12,
        border: `1.5px solid ${found ? MINT : 'rgba(244,238,225,.18)'}`,
        background: 'rgba(244,238,225,.04)', transition: 'border-color .3s ease',
      }}>
        <span style={{ color: FAINTER, fontFamily: MONO, fontSize: 13.5 }}>t.me/</span>
        <span style={{ flex: 1, fontFamily: MONO, fontSize: 13.5, color: CREAM }}>selamboutique</span>
        {found ? (
          <span style={{
            background: MINT, color: '#fff', fontSize: 11, fontWeight: 600,
            padding: '6px 13px', borderRadius: 999, animation: 'hiw-pop .35s both',
          }}>Connected</span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'rgba(244,238,225,.6)' }}>
            <span style={{
              width: 12, height: 12, border: '2px solid rgba(244,238,225,.25)', borderTopColor: GOLDSF,
              borderRadius: '50%', animation: 'hiw-spin .7s linear infinite',
            }} />
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
              borderTop: '1px solid rgba(244,238,225,.1)',
              animation: `hiw-up .4s ${0.12 * i}s both`,
            }}>
              <span style={{ fontSize: 17 }}>📦</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: CREAM }}>{it.name}</div>
                <div style={{ fontSize: 11, color: FAINTER }}>{it.meta}</div>
              </div>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', background: MINT, color: '#fff',
                display: 'grid', placeItems: 'center', fontSize: 11,
              }}>✓</span>
            </div>
          ))}
        </div>
      )}
      <Keyframes />
    </div>
  );
}

// S1 — a real exchange, so "answers in your voice" stops being abstract.
function ChatDemo() {
  return (
    <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        alignSelf: 'flex-start', maxWidth: '78%', background: 'rgba(244,238,225,.08)', color: CREAM,
        padding: '11px 14px', borderRadius: '16px 16px 16px 4px', fontSize: 13.5, lineHeight: 1.45,
        animation: 'hiw-bub .4s .1s both',
      }}>Is the habesha dress still available?</div>
      <div style={{
        alignSelf: 'flex-end', maxWidth: '80%', background: CREAM, color: INK,
        padding: '11px 14px', borderRadius: '16px 16px 4px 16px', fontSize: 13.5, lineHeight: 1.45,
        animation: 'hiw-bub .4s .5s both',
      }}>Yes! It&apos;s 1,200 ETB in red or cream. Want me to hold one for you? 😊</div>
      <div style={{ alignSelf: 'flex-end', fontSize: 10, color: 'rgba(244,238,225,.4)', animation: 'hiw-bub .4s .7s both' }}>
        MiniMe · replied in 3s
      </div>
      <Keyframes />
    </div>
  );
}

// S2 — the approval moment, shown exactly as it appears on Home.
function DraftDemo() {
  return (
    <div style={{
      marginTop: 22, background: PANEL, border: `1px solid ${PANEL_B}`, borderRadius: 18, padding: 16,
      animation: 'hiw-bub .4s .15s both',
    }}>
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
      <Keyframes />
    </div>
  );
}

// S3 — the owner seeing their own shop as the top result.
function SearchDemo() {
  return (
    <>
      <div style={{ marginTop: 22, background: '#fff', borderRadius: 16, padding: 14, animation: 'hiw-bub .4s .15s both' }}>
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
          <span style={{ background: 'rgba(79,163,138,.14)', color: '#3C8E77', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>Your shop</span>
        </div>
      </div>
      <div style={{
        marginTop: 12, display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px',
        background: PANEL, border: `1px solid ${PANEL_B}`, borderRadius: 14, animation: 'hiw-bub .4s .3s both',
      }}>
        <span style={{ fontSize: 16 }}>🌍</span>
        <div style={{ fontSize: 12, color: FAINT, lineHeight: 1.4 }}>
          Auto-listed on <span style={{ fontFamily: MONO, color: GOLDSF }}>@MiniMeSearchBot</span>
        </div>
      </div>
      <Keyframes />
    </>
  );
}

// S4 — the exact field they'll fill in Telegram, typing itself in.
function SecretaryDemo({ typed, stage }) {
  const connecting = stage === 'connecting';
  const done = stage === 'done';
  return (
    <div style={{ marginTop: 22, background: PANEL, border: `1px solid ${PANEL_B}`, borderRadius: 18, padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: FAINTER, marginBottom: 9 }}>
        Telegram · Chat automations
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12,
        border: `1.5px solid ${done ? MINT : GOLDSF}`, background: 'rgba(244,238,225,.04)',
        transition: 'border-color .3s ease',
      }}>
        <span style={{ color: FAINTER, fontFamily: MONO, fontSize: 14 }}>@</span>
        <span style={{ flex: 1, fontFamily: MONO, fontSize: 14, color: CREAM }}>
          {typed}
          {!done && <span style={{ display: 'inline-block', width: 2, height: 15, background: GOLDSF, verticalAlign: -2, animation: 'hiw-blink 1s step-end infinite' }} />}
        </span>
        {connecting && (
          <span style={{ width: 16, height: 16, border: '2px solid rgba(244,238,225,.25)', borderTopColor: GOLDSF, borderRadius: '50%', animation: 'hiw-spin .7s linear infinite' }} />
        )}
        {done && (
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: MINT, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12, animation: 'hiw-pop .4s both' }}>✓</span>
        )}
      </div>
      {done ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, padding: '10px 12px', borderRadius: 11, background: 'rgba(79,163,138,.14)', animation: 'hiw-bub .4s both' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: MINT }} />
          <span style={{ fontSize: 12.5, color: '#8FC7B0', fontWeight: 600 }}>Connected — MiniMe now replies from your account.</span>
        </div>
      ) : connecting ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: FAINTER, marginTop: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: GOLDSF, animation: 'hiw-blink 1s step-end infinite' }} />
          Connecting to Telegram…
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: FAINTER, marginTop: 10 }}>
          In Telegram: Settings → Business → Chatbots → enter{' '}
          <span style={{ fontFamily: MONO, color: GOLDSF }}>@minimeagentbot</span>
        </div>
      )}
      <Keyframes />
    </div>
  );
}

// S5 — the closing promise, with the three numbers that matter.
function ReadyPanel({ s, body }) {
  return (
    <div style={{ textAlign: 'center', paddingTop: 20 }}>
      <div style={{
        width: 84, height: 84, borderRadius: 24, background: s.tint,
        display: 'grid', placeItems: 'center', fontSize: 42, margin: '0 auto', animation: 'hiw-pop .5s both',
      }}>{s.emoji}</div>
      <div style={{ fontFamily: SERIF, fontSize: 31, color: CREAM, lineHeight: 1.14, marginTop: 22 }}>
        {s.title}<span style={{ fontStyle: 'italic', color: GOLDSF }}>{s.italic}</span>
      </div>
      <p style={{ fontSize: 15, color: FAINT, lineHeight: 1.55, marginTop: 12, maxWidth: 290, marginLeft: 'auto', marginRight: 'auto' }}>
        {body}
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
      <Keyframes />
    </div>
  );
}

// Scoped keyframes — prefixed so they can't collide with app-wide animations.
function Keyframes() {
  return (
    <style>{`
      @keyframes hiw-spin { to { transform: rotate(360deg); } }
      @keyframes hiw-blink { 50% { opacity: 0; } }
      @keyframes hiw-pop { from { opacity:0; transform:scale(.8);} to { opacity:1; transform:scale(1);} }
      @keyframes hiw-bub { from { opacity:0; transform:translateY(8px) scale(.97);} to { opacity:1; transform:none;} }
      @keyframes hiw-up { from { opacity:0; transform:translateY(10px);} to { opacity:1; transform:none;} }
    `}</style>
  );
}

// ─── Trigger ──────────────────────────────────────────────────────────────────
export function HowItWorksTrigger({ onClick, variant = 'light' }) {
  const dark = variant === 'dark';
  return (
    <button onClick={onClick} style={{
      appearance: 'none', cursor: 'pointer', fontFamily: BODY,
      background: dark ? 'rgba(244,238,225,.12)' : 'transparent',
      color: dark ? CREAM : GOLD,
      border: `1px solid ${dark ? 'rgba(244,238,225,.22)' : 'rgba(176,138,74,.35)'}`,
      padding: dark ? '11px 15px' : '9px 14px',
      borderRadius: 999, fontSize: 13, fontWeight: 500,
    }}>
      How it works
    </button>
  );
}
