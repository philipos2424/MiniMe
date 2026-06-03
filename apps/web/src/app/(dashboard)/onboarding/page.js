'use client';
import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTelegram } from '../../../context/TelegramContext';
import { isOnboarded } from '../../../lib/onboarding-status';
import { extractToken, isValidBotToken, friendlyLinkError } from '../../../lib/botToken';
import { MiniMeLogo } from '../../../components/ui/MiniMeLogo';

// ─── Design tokens (local) ────────────────────────────────────────────────────
const INK    = '#0E2823';
const PAPER  = '#FBF8F1';
const CREAM  = '#F4EEE1';
const GOLD   = '#B08A4A';
const GOLDSF = '#D4B987';
const MINT   = '#4FA38A';
const LINE   = '#E4DED1';
const MUTED  = '#8A9590';
const ERROR  = '#B85450';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const MONO   = "'Geist Mono', ui-monospace, monospace";

// localStorage key for resuming the wizard across the BotFather app-switch.
const ONB_RESUME_KEY = 'minime_onb_resume_v1';

const CATEGORIES = [
  { id: 'branding_design',       label: 'Branding & Design' },
  { id: 'printing_signage',      label: 'Printing & Signage' },
  { id: 'photography_video',     label: 'Photography' },
  { id: 'catering_food',         label: 'Catering & Food' },
  { id: 'food_beverage',         label: 'Restaurant & Café' },
  { id: 'it_tech',               label: 'IT & Tech' },
  { id: 'events_entertainment',  label: 'Events' },
  { id: 'clothing_fashion',      label: 'Fashion' },
  { id: 'beauty_wellness',       label: 'Beauty' },
  { id: 'construction_interior', label: 'Construction' },
  { id: 'transport_delivery',    label: 'Transport' },
  { id: 'training_consulting',   label: 'Consulting' },
  { id: 'wholesale_supply',      label: 'Wholesale' },
  { id: 'electronics_phones',    label: 'Electronics' },
  { id: 'other',                 label: 'Other' },
];

// ─── Refined line-icon set ──────────────────────────────────────────────────
// Thin, uniform, currentColor — no emoji. One visual language across the flow.
function LineIcon({ name, size = 20, color = GOLD, strokeWidth = 1.4 }) {
  const p = {
    reply:   <path d="M20.5 11.3a8 8 0 0 1-11.7 7.1L4 19.5l1.1-4.8A8 8 0 1 1 20.5 11.3Z" />,
    tag:     <><path d="M3.5 11.4 11.4 3.5H19a1.5 1.5 0 0 1 1.5 1.5v7.6l-7.9 7.9a1.5 1.5 0 0 1-2.1 0l-7-7a1.5 1.5 0 0 1 0-2.1Z" /><circle cx="15.8" cy="8.2" r="1.15" /></>,
    learn:   <><path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.6 10.4 11.2 6 9.6 10.4 8 12 3.5Z" /><path d="M18.4 15.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" /></>,
    shield:  <><path d="M12 3.5l6.5 2.6V11c0 4.1-2.8 7.1-6.5 8.4C8.3 18.1 5.5 15.1 5.5 11V6.1L12 3.5Z" /><path d="M9.3 11.7l1.9 1.9 3.6-3.8" /></>,
    spark:   <path d="M13 3.5 6 13h5l-1 7.5L17 11h-5l1-7.5Z" />,
    bot:     <><rect x="4.8" y="8" width="14.4" height="10.5" rx="3.2" /><path d="M12 4.2v3.8M9 12.8v1.2M15 12.8v1.2" /><circle cx="12" cy="3.4" r="1.05" /></>,
    lock:    <><rect x="5" y="11" width="14" height="8.5" rx="2.4" /><path d="M8 11V8.2a4 4 0 0 1 8 0V11" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {p[name]}
    </svg>
  );
}

// ─── Editorial numbered step list (gold serif numerals, hairline rules) ───────
function NumberedSteps({ items }) {
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((s, i) => (
        <li key={i} className={`fade-up delay-${Math.min(i + 2, 5)}`} style={{
          display: 'flex', gap: 16, alignItems: 'flex-start', padding: '15px 0',
          borderTop: i === 0 ? 'none' : `1px solid ${LINE}`,
        }}>
          <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 22, color: GOLD, lineHeight: 1.05, minWidth: 26 }}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: INK, lineHeight: 1.25 }}>{s.title}</div>
            <div style={{ fontSize: 13, color: '#4A5E5A', marginTop: 4, lineHeight: 1.5 }}>{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Loader ───────────────────────────────────────────────────────────────────
// authReady = true once TelegramContext finishes auth (loading===false).
// The animation still plays but onDone is only called once BOTH are satisfied.
function Loader({ onDone, authReady }) {
  const [p, setP] = useState(0);
  const [phase, setPhase] = useState(0);
  const [animDone, setAnimDone] = useState(false);

  // Gate: proceed only when animation finished AND auth completed
  useEffect(() => {
    if (animDone && authReady) {
      const t = setTimeout(onDone, 200);
      return () => clearTimeout(t);
    }
  }, [animDone, authReady, onDone]);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 400);
    const t2 = setTimeout(() => setPhase(2), 900);
    let progress = 0;
    const iv = setInterval(() => {
      progress += Math.random() * 18 + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(iv);
        // Signal animation complete — onDone fires via the effect above
        setTimeout(() => setAnimDone(true), 350);
      }
      setP(Math.min(progress, 100));
    }, 120);
    return () => { clearTimeout(t1); clearTimeout(t2); clearInterval(iv); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'radial-gradient(ellipse at center, #14342E 0%, #0A1E1B 80%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: BODY, overflow: 'hidden',
    }}>
      <div className="grain" />

      {/* Logo mark */}
      <div className="mirror-reveal" style={{ marginBottom: 28 }}>
        <MiniMeLogo size={86} color={CREAM} accent={GOLDSF} />
      </div>

      {/* Wordmark */}
      <div className="fade-up delay-2" style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: SERIF, fontWeight: 300, fontStyle: 'italic', fontSize: 34, color: CREAM, letterSpacing: '-0.015em' }}>
          minime
        </div>
        <div className="fade-in delay-3" style={{
          marginTop: 10, color: 'rgba(244,238,225,0.55)',
          letterSpacing: '0.16em', textTransform: 'uppercase', fontSize: 10,
        }}>
          your business, mirrored
        </div>
      </div>

      {/* Progress */}
      <div style={{ position: 'absolute', bottom: 90, left: 50, right: 50 }}>
        <div className="prog">
          <div className="prog-fill" style={{ width: `${p}%` }} />
        </div>
      </div>
      <div style={{
        position: 'absolute', bottom: 40, left: 0, right: 0, textAlign: 'center',
        fontSize: 11, color: 'rgba(244,238,225,0.35)', letterSpacing: '0.2em', textTransform: 'uppercase',
      }}>
        {p < 40 ? 'Connecting…' : p < 75 ? 'Loading your business…' : p < 95 ? 'Almost ready…' : 'Ready'}
      </div>
    </div>
  );
}

// ─── Onboarding shell ─────────────────────────────────────────────────────────
function Shell({ step, total, onBack, onNext, ctaLabel = 'Continue', disabled, secondaryLabel, onSecondary, busy, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: PAPER, display: 'flex', flexDirection: 'column', fontFamily: BODY, color: INK }}>
      {/* Top bar — padded for Telegram fullscreen safe area */}
      <div style={{ padding: 'max(14px, env(safe-area-inset-top)) 22px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={onBack}
          style={{ border: 0, background: 'transparent', padding: 6, cursor: 'pointer', opacity: step === 0 ? 0 : 1, pointerEvents: step === 0 ? 'none' : 'auto', lineHeight: 1 }}
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6"/>
          </svg>
        </button>
        {/* Dot progress */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} style={{
              height: 6, borderRadius: 3,
              width: i === step ? 18 : 6,
              // Three states: done (filled, dimmed) · current (bold pill) · upcoming (grey).
              // Progress visibly accumulates instead of every past step looking un-done.
              background: i <= step ? INK : LINE,
              opacity: i < step ? 0.4 : 1,
              transition: 'all .25s ease',
              display: 'inline-block',
            }} />
          ))}
        </div>
        <div style={{ width: 34 }} />
      </div>

      {/* Body — scrollable area */}
      <div style={{
        flex: 1, padding: '20px 24px 24px', display: 'flex', flexDirection: 'column',
        overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        minHeight: 0, /* critical: allows flex child to shrink & scroll */
      }}>
        {children}
      </div>

      {/* Footer */}
      <div style={{ padding: '0 22px', paddingBottom: 'max(28px, env(safe-area-inset-bottom))', borderTop: `1px solid ${LINE}` }}>
        <div style={{ paddingTop: 16 }}>
          <button
            onClick={onNext}
            disabled={disabled || busy}
            style={{
              width: '100%', appearance: 'none', border: 0,
              background: disabled || busy ? '#C8C0B8' : INK,
              color: PAPER, padding: '16px', borderRadius: 999,
              fontSize: 15, fontWeight: 500, cursor: disabled || busy ? 'default' : 'pointer',
              fontFamily: BODY, letterSpacing: '-0.01em',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 120ms ease',
            }}
          >
            {busy ? 'Connecting…' : ctaLabel}
            {!busy && (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={PAPER} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7"/>
              </svg>
            )}
          </button>
          {secondaryLabel && (
            <button
              onClick={onSecondary}
              style={{ display: 'block', width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: BODY, fontSize: 14, color: MUTED, marginTop: 14, textAlign: 'center' }}
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 0: What do you sell? ──────────────────────────────────────────────
// The ONLY thing we ask before showing value. One short phrase → drives the demo.
function StepSell({ value, setValue, onNext, onBack }) {
  const sells = value.sells;
  return (
    <Shell step={0} total={4} onBack={onBack} onNext={onNext} ctaLabel="Show me" disabled={!sells.trim()}>
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>Let's begin</div>
        <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
          What do you <span style={{ fontStyle: 'italic' }}>sell</span>?
        </div>
        <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.45 }}>
          In a few words. I'll show you exactly what I'd say to a customer.
        </p>
      </div>

      <div className="fade-up delay-1" style={{ marginTop: 28 }}>
        <input
          placeholder="e.g. leather bags, coffee, salon services"
          value={sells}
          onChange={e => setValue({ ...value, sells: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter' && sells.trim()) onNext(); }}
          autoFocus
          style={{ marginTop: 0 }}
        />
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 12, lineHeight: 1.5 }}>
          No forms. No bot setup. Just tell me your business and watch what happens.
        </div>
      </div>
    </Shell>
  );
}

// ─── Step 1: The mirror ─────────────────────────────────────────────────────
// Show the assistant answering — BEFORE asking for any data. This is the whole
// product in ten seconds. The chat is templated from their own word, so it feels
// personal, not canned. (Fake/templated by design — swap to a live call later.)
function StepDemo({ sells, onNext, onBack }) {
  const [stage, setStage] = useState(0); // 0 = empty · 1 = customer · 2 = reply
  useEffect(() => {
    const ts = [
      setTimeout(() => setStage(1), 450),
      setTimeout(() => setStage(2), 1700),
    ];
    return () => ts.forEach(clearTimeout);
  }, []);
  const item = (sells || '').trim() || 'that';
  const customerMsg = `Hi! Do you have ${item}?`;
  const replyMsg = `Yes — we've got ${item}! Want me to share the prices and details? 😊`;
  return (
    <Shell step={1} total={4} onBack={onBack} onNext={onNext} ctaLabel="Make it know my prices" disabled={stage < 2}>
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>Watch</div>
        <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.12 }}>
          This is MiniMe — <span style={{ fontStyle: 'italic' }}>answering as you</span>.
        </div>
      </div>

      <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        {/* Customer — incoming, left */}
        {stage >= 1 && (
          <div className="fade-up" style={{ alignSelf: 'flex-start', maxWidth: '84%' }}>
            <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 4, marginLeft: 4 }}>A customer</div>
            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: '4px 16px 16px 16px', padding: '11px 15px', fontSize: 14.5, color: INK, lineHeight: 1.4 }}>
              {customerMsg}
            </div>
          </div>
        )}
        {/* You / MiniMe — outgoing, right */}
        {stage >= 2 && (
          <div className="fade-up" style={{ alignSelf: 'flex-end', maxWidth: '84%' }}>
            <div style={{ fontSize: 10.5, color: MINT, marginBottom: 4, marginRight: 4, textAlign: 'right', fontWeight: 600 }}>You · MiniMe</div>
            <div style={{ background: MINT, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '11px 15px', fontSize: 14.5, lineHeight: 1.4 }}>
              {replyMsg}
            </div>
          </div>
        )}
      </div>

      {stage >= 2 && (
        <div className="fade-up" style={{ marginTop: 8, fontSize: 12.5, color: '#4A5E5A', textAlign: 'center', lineHeight: 1.5 }}>
          That was a preview. Teach me your <strong style={{ color: INK }}>real prices</strong> and I'll quote them exactly — to every customer, day and night.
        </div>
      )}
    </Shell>
  );
}

// ─── Step 2: Teach prices ───────────────────────────────────────────────────
// The catalog seed. Strongly framed but skippable — the demo did the persuading,
// and a hard gate would just spike abandonment. Feeds /api/teach → real products.
function StepTeach({ value, setValue, onNext, onBack, busy }) {
  const desc = value.description;
  return (
    <Shell step={2} total={4} onBack={onBack} onNext={onNext}
           ctaLabel={desc.trim() ? 'Add to my catalog' : 'Continue'} disabled={false} busy={busy}
           secondaryLabel="Skip — I'll add prices later" onSecondary={onNext}>
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>Almost there</div>
        <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
          Teach me your <span style={{ fontStyle: 'italic' }}>prices</span>.
        </div>
        <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.45 }}>
          List a few items with prices — one per line. I'll quote them exactly.
        </p>
      </div>

      <div className="fade-up delay-1" style={{ marginTop: 24 }}>
        <textarea
          placeholder={'e.g.\nLeather bag — 2500 birr\nWallet — 800 birr\nBelt — 600 birr'}
          value={desc}
          onChange={e => setValue({ ...value, description: e.target.value })}
          rows={5}
          autoFocus
          style={{ marginTop: 0, resize: 'vertical', lineHeight: 1.6 }}
        />
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 10, lineHeight: 1.5 }}>
          You can also snap a photo of your price list later, or just message MiniMe. Don't worry about getting it perfect.
        </div>
      </div>
    </Shell>
  );
}

// ─── Copy link button with visual feedback ──────────────────────────────────
function CopyLinkButton({ deepLink }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(deepLink).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
      }}
      style={{
        marginTop: 10, appearance: 'none', border: `1px solid ${copied ? MINT : LINE}`,
        background: copied ? 'rgba(79,163,138,0.1)' : '#fff',
        color: copied ? MINT : INK,
        padding: '8px 18px', borderRadius: 999,
        fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: BODY,
        transition: 'all 0.2s ease',
      }}
    >
      {copied ? '✓ Copied!' : 'Copy link'}
    </button>
  );
}

// ─── Phone capture (post-activation) ─────────────────────────────────────────
// Placed on the success screens, NOT as a gate before going live — asking for a
// number before the owner has seen value spikes abandonment. By here they're
// already activated and motivated. "What's your number?" is the single most
// common customer question, so capturing it now is what lets MiniMe answer it
// truthfully instead of saying "I'll get that from the owner." Optional by
// design: a blank number is fine, a wrong/forced one is worse.
function PhoneCapture({ initData, preview = false }) {
  const [phone, setPhone] = useState('');
  const [state, setState] = useState(''); // '' | 'saving' | 'done'
  const valid = phone.replace(/[^0-9]/g, '').length >= 7;

  async function save() {
    if (!valid || state === 'saving') return;
    setState('saving');
    if (preview) { setTimeout(() => setState('done'), 600); return; }
    try {
      await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ owner_phone: phone.trim() }),
      });
      setState('done');
    } catch {
      // Non-blocking — they can always add it later in Settings → Profile.
      setState('done');
    }
  }

  if (state === 'done') {
    return (
      <div className="fade-in" style={{
        marginTop: 24, background: 'rgba(79,163,138,0.1)', border: `1px solid rgba(79,163,138,0.3)`,
        borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={MINT} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l4 4 10-10"/>
        </svg>
        <span style={{ fontSize: 13.5, color: INK, fontWeight: 500 }}>
          Saved — MiniMe will share your number when customers ask.
        </span>
      </div>
    );
  }

  return (
    <div className="fade-up delay-1" style={{ marginTop: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
        Your phone number
      </div>
      <div style={{
        background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px',
      }}>
        <p style={{ fontSize: 13, color: '#4A5E5A', margin: '0 0 12px', lineHeight: 1.5 }}>
          Customers ask for your number more than anything else. Add it and MiniMe shares it on request — otherwise it'll just say it doesn't have one.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="tel"
            inputMode="tel"
            placeholder="+251 911 234 567"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && valid) save(); }}
            style={{
              flex: 1, appearance: 'none', border: `1px solid ${LINE}`, borderRadius: 999,
              padding: '11px 16px', fontSize: 15, fontFamily: BODY, color: INK, background: PAPER, outline: 'none',
            }}
          />
          <button
            onClick={save}
            disabled={!valid || state === 'saving'}
            style={{
              appearance: 'none', border: 0, borderRadius: 999, padding: '0 20px',
              background: valid && state !== 'saving' ? INK : '#C8C0B8', color: PAPER,
              fontSize: 14, fontWeight: 500, fontFamily: BODY,
              cursor: valid && state !== 'saving' ? 'pointer' : 'default', whiteSpace: 'nowrap',
            }}
          >
            {state === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
          Optional — you can add or change this anytime in Settings → Profile.
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Connect bot ─────────────────────────────────────────────────────
function StepConnect({ onNext, onBack, onSkip, initData, setBusiness, onTrack, preview = false }) {
  // mode '' shows the chooser: "Use MiniMe directly" (instant, recommended) vs
  // "Connect your own bot" (BotFather). Both are offered up front so owners can
  // bring their own bot — the recommended path is still a single tap.
  const [mode, setMode]     = useState(''); // '' = choose | 'custom' = BotFather | 'shared' = MiniMe direct
  const [token, setToken]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [status, setStatus] = useState(''); // '' | 'connecting' | 'done' | 'shared_done'
  const [err, setErr]       = useState('');
  const [shopCode, setShopCode] = useState('');

  // Failsafe: if we reach 'done' but setBusiness/context update fails silently,
  // auto-navigate to dashboard after 4s so user never gets permanently stuck.
  useEffect(() => {
    if (status !== 'done' && status !== 'shared_done') return;
    // Funnel: record the actual activation (custom bot vs shared mode) — the
    // single most important conversion event in the whole product.
    onTrack?.(status === 'done' ? 'connected_custom' : 'connected_shared');
    const t = setTimeout(() => onNext(), 4000);
    return () => clearTimeout(t);
  }, [status, onNext]); // eslint-disable-line react-hooks/exhaustive-deps
  // Validate against the cleaned token, mirroring the server's own regex — so a
  // sloppy paste (extra text/whitespace) that the server would accept passes here
  // too, and one that it would reject is caught BEFORE a wasted round-trip.
  const cleanToken = extractToken(token);
  const valid = isValidBotToken(token);

  // When the owner returns from BotFather, the token is almost always still on
  // their clipboard. Auto-read it the moment the custom screen opens so they
  // don't have to find the paste field and long-press. Best-effort + silent —
  // clipboard access is gated/*blocked* in some webviews, hence the Paste button.
  const [pasteErr, setPasteErr] = useState('');
  useEffect(() => {
    if (mode !== 'custom' || token) return;
    let cancelled = false;
    (async () => {
      try {
        const txt = await navigator.clipboard?.readText();
        const t = extractToken(txt);
        if (!cancelled && isValidBotToken(t)) setToken(t);
      } catch { /* permission denied / unsupported — the Paste button covers it */ }
    })();
    return () => { cancelled = true; };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pasteFromClipboard() {
    setPasteErr('');
    try {
      const txt = await navigator.clipboard.readText();
      const t = extractToken(txt);
      if (isValidBotToken(t)) { setToken(t); setErr(''); }
      else setPasteErr('No bot token found on your clipboard. Copy it from BotFather first, then tap Paste.');
    } catch {
      setPasteErr('Couldn’t read the clipboard here — long-press the box below and tap Paste.');
    }
  }

  async function connect() {
    // Replay/preview mode: this is a non-destructive walkthrough. Don't touch
    // the live business — just show the success screen so the owner can see it.
    if (preview) {
      setStatus('connecting');
      setTimeout(() => setStatus('done'), 900);
      return;
    }
    setBusy(true); setErr(''); setStatus('connecting');
    try {
      // Default: 24/7 — bot always replies, no quiet hours.
      // Owners can enable quiet hours later in Settings → Hours if they want.
      await fetch('/api/settings/hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ enabled: false }),
      }).catch(() => {});
      const r = await fetch('/api/bot/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ token: cleanToken, workspace_type: 'business' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(friendlyLinkError(j.error, 'Failed to link bot. Check the token and try again.'));

      // Refresh business in context — without this, the dashboard reads the
      // stale (pre-link) business and bounces back to /onboarding step 0
      try {
        const auth = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        });
        const authJ = await auth.json();
        if (authJ?.business && setBusiness) setBusiness(authJ.business);
      } catch (refreshErr) {
        console.warn('Failed to refresh business after bot link:', refreshErr.message);
      }

      setStatus('done');
    } catch (e) { setErr(e.message); setStatus(''); } finally { setBusy(false); }
  }

  async function activateSharedMode() {
    // Replay/preview mode: non-destructive walkthrough — simulate success.
    if (preview) {
      setStatus('connecting');
      setTimeout(() => { setShopCode('preview'); setStatus('shared_done'); }, 900);
      return;
    }
    setBusy(true); setErr(''); setStatus('connecting');
    try {
      // Default: 24/7 — bot always replies, no quiet hours.
      await fetch('/api/settings/hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ enabled: false }),
      }).catch(() => {});

      const r = await fetch('/api/onboarding/complete-shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(friendlyLinkError(j.error, 'Failed to activate. Please try again.'));

      if (j.shop_code) setShopCode(j.shop_code);

      // Refresh business in context
      try {
        const auth = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        });
        const authJ = await auth.json();
        if (authJ?.business && setBusiness) setBusiness(authJ.business);
      } catch (refreshErr) {
        console.warn('Failed to refresh business after shared mode:', refreshErr.message);
      }

      setStatus('shared_done');
    } catch (e) {
      // Reset to the chooser so the owner has a manual path forward (incl. retry).
      setErr(e.message); setStatus(''); setMode('');
    } finally { setBusy(false); }
  }

  if (status === 'connecting') {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: PAPER, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40, fontFamily: BODY,
      }}>
        <div className="loader-arc" />
        <div style={{ fontFamily: SERIF, fontSize: 22, marginTop: 22, color: INK }}>
          {mode === 'shared' ? 'Activating MiniMe…' : 'Mirroring your bot…'}
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
          {mode === 'shared' ? 'generating your link · setting up AI' : 'setting up webhook · loading voice profile'}
        </div>
      </div>
    );
  }

  // ─── Success: Custom bot connected ─────────────────────────────────────
  if (status === 'done') {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: PAPER, display: 'flex', flexDirection: 'column',
        fontFamily: BODY, overflowY: 'auto',
        paddingTop: 'max(40px, env(safe-area-inset-top))',
        paddingBottom: 'max(28px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ flex: 1, padding: '0 24px', display: 'flex', flexDirection: 'column' }}>
          {/* Success mark */}
          <div className="fade-up" style={{ textAlign: 'center', paddingTop: 16 }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: 'rgba(79,163,138,0.15)',
              display: 'grid', placeItems: 'center', margin: '0 auto',
            }}>
              <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={MINT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l4 4 10-10"/>
              </svg>
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 30, marginTop: 16, color: INK, letterSpacing: '-0.015em' }}>You're live.</div>
            <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.5 }}>
              MiniMe is now active on your bot. Here's what to do next to get the best results.
            </p>
          </div>

          {/* Phone capture — high-intent moment, optional */}
          <PhoneCapture initData={initData} preview={preview} />

          {/* Next steps */}
          <div className="fade-up delay-1" style={{ marginTop: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 4 }}>
              Do these 4 things now
            </div>
            <NumberedSteps items={[
              {
                title: 'Send /start to your own bot',
                body: 'Open your bot in Telegram and send /start. This activates it and lets you test it yourself first before sharing with customers.',
              },
              {
                title: 'Add your products & prices',
                body: 'Go to Catalog in the menu and add what you sell with prices. MiniMe will quote exact prices to every customer — no more "DM for price."',
              },
              {
                title: 'Teach it about your business',
                body: 'Tap Teach MiniMe and describe your business in your own words — services, delivery zones, payment methods, anything. The more you teach, the better it replies.',
              },
              {
                title: 'Share your bot link with customers',
                body: 'Your bot link is t.me/yourbotname. Put it in your Instagram bio, Facebook page, and WhatsApp status. Customers tap it and start chatting.',
              },
            ]} />
          </div>

          {/* Bot commands reference */}
          <div className="fade-up delay-5" style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
              Commands you can use in your bot
            </div>
            <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['/orders', 'See pending orders & jobs'],
                ['/sales', 'Revenue today / this week / month'],
                ['/stock', 'Inventory levels & low-stock alerts'],
                ['/price Injera 18', 'Update a product price instantly'],
                ['/restock Item +50', 'Add stock quantity'],
                ['/teach', 'Teach MiniMe something new'],
                ['/rule use emojis', 'Add a reply behavior rule'],
                ['/advisor', 'Ask the AI advisor anything'],
                ['/dm Sara your order is ready', 'DM a customer directly'],
              ].map(([cmd, desc]) => (
                <div key={cmd} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <code style={{ fontFamily: MONO, fontSize: 11.5, color: GOLD, background: 'rgba(176,138,74,0.1)', padding: '2px 6px', borderRadius: 5, whiteSpace: 'nowrap' }}>{cmd}</code>
                  <span style={{ fontSize: 12.5, color: '#4A5E5A' }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: '16px 24px' }}>
          <button
            onClick={onNext}
            style={{
              width: '100%', appearance: 'none', border: 0,
              background: INK, color: PAPER, padding: '16px', borderRadius: 999,
              fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: BODY,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            Open my dashboard
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={PAPER} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ─── Success: Shared mode activated ────────────────────────────────────
  if (status === 'shared_done') {
    // Share the BRANDED storefront page, not the raw t.me link. Pasting a
    // t.me/MiniMeAgentBot link into Instagram/WhatsApp shows MiniMe's avatar &
    // name in the preview — so the owner's store looks like "MiniMe". The
    // /shop/<code> page is one we control, so its preview shows the owner's
    // own business; the page then forwards customers into the bot.
    const webBase = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');
    const deepLink = `${webBase}/shop/${shopCode}`;
    return (
      <div style={{
        position: 'fixed', inset: 0, background: PAPER, display: 'flex', flexDirection: 'column',
        fontFamily: BODY, overflowY: 'auto',
        paddingTop: 'max(40px, env(safe-area-inset-top))',
        paddingBottom: 'max(28px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ flex: 1, padding: '0 24px', display: 'flex', flexDirection: 'column' }}>
          {/* Success mark */}
          <div className="fade-up" style={{ textAlign: 'center', paddingTop: 16 }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: 'rgba(79,163,138,0.15)',
              display: 'grid', placeItems: 'center', margin: '0 auto',
            }}>
              <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={MINT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l4 4 10-10"/>
              </svg>
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 30, marginTop: 16, color: INK, letterSpacing: '-0.015em' }}>You're live.</div>
            <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.5 }}>
              MiniMe is ready to handle your customers. Share your link and start teaching!
            </p>
          </div>

          {/* Phone capture — high-intent moment, optional */}
          <PhoneCapture initData={initData} preview={preview} />

          {/* Deep link card */}
          <div className="fade-up delay-1" style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
              Your customer link
            </div>
            <div style={{
              background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14,
              padding: '16px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: MONO, fontSize: 12.5, color: INK, wordBreak: 'break-all', lineHeight: 1.5 }}>
                {deepLink}
              </div>
              <CopyLinkButton deepLink={deepLink} />
            </div>
          </div>

          {/* Next steps */}
          <div className="fade-up delay-2" style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 4 }}>
              Do these 3 things now
            </div>
            <NumberedSteps items={[
              {
                title: 'Add your products & prices',
                body: 'Go to Catalog in the menu and add what you sell with prices. MiniMe will quote exact prices to every customer.',
              },
              {
                title: 'Teach it about your business',
                body: 'Tap Teach MiniMe or message @MiniMeAgentBot directly — send text, photos, files, voice notes. The more you teach, the better it replies.',
              },
              {
                title: 'Share your link with customers',
                body: 'Put your customer link in your Instagram bio, Facebook page, and WhatsApp status. Customers tap it and start chatting with your AI.',
              },
            ]} />
          </div>

          {/* Tip: you can connect your own bot later */}
          <div className="fade-up delay-5" style={{ marginTop: 16 }}>
            <div style={{
              background: 'rgba(176,138,74,0.08)', border: `1px solid rgba(176,138,74,0.2)`,
              borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#4A5E5A', lineHeight: 1.5,
            }}>
              Want your own @YourShopBot? You can connect a BotFather bot anytime from Settings.
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: '16px 24px' }}>
          <button
            onClick={onNext}
            style={{
              width: '100%', appearance: 'none', border: 0,
              background: INK, color: PAPER, padding: '16px', borderRadius: 999,
              fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: BODY,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            Open my dashboard
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={PAPER} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ─── Mode chooser: Shared vs Custom ────────────────────────────────────
  if (!mode) {
    return (
      <Shell step={3} total={4} onBack={onBack} onNext={activateSharedMode} ctaLabel="Use MiniMe directly"
             disabled={false} busy={busy}>
        <div className="fade-up">
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
            Step two · last one
          </div>
          <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
            Go <span style={{ fontStyle: 'italic' }}>live</span>.
          </div>
          <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.45 }}>
            Choose how customers will reach you.
          </p>
        </div>

        {/* Option 1: Use MiniMe directly (recommended) */}
        <div className="fade-up delay-1" style={{ marginTop: 24 }}>
          <button
            onClick={activateSharedMode}
            disabled={busy}
            style={{
              width: '100%', appearance: 'none', textAlign: 'left', fontFamily: BODY,
              cursor: busy ? 'default' : 'pointer',
              background: '#fff', border: `2px solid ${MINT}`, borderRadius: 16,
              padding: '18px 18px 16px', position: 'relative',
            }}>
            <div style={{
              position: 'absolute', top: -10, right: 16,
              background: MINT, color: '#fff', fontSize: 10, fontWeight: 600,
              padding: '3px 10px', borderRadius: 999, letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              Recommended
            </div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={{
                width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                background: 'rgba(79,163,138,0.1)', display: 'grid', placeItems: 'center',
              }}>
                <LineIcon name="spark" color={MINT} size={20} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Use MiniMe directly</div>
                <div style={{ fontSize: 13, color: '#4A5E5A', marginTop: 4, lineHeight: 1.45 }}>
                  Go live instantly — no setup needed. Customers chat with you through a link. You can teach MiniMe right here or by messaging @MiniMeAgentBot.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {['Instant setup', 'Shareable link', 'Full AI features'].map(tag => (
                    <span key={tag} style={{
                      fontSize: 11, color: MINT, background: 'rgba(79,163,138,0.1)',
                      padding: '3px 10px', borderRadius: 999, fontWeight: 500,
                    }}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </button>
        </div>

        {/* Divider */}
        <div className="fade-up delay-2" style={{
          display: 'flex', alignItems: 'center', gap: 14, marginTop: 20, marginBottom: 4,
        }}>
          <div style={{ flex: 1, height: 1, background: LINE }} />
          <span style={{ fontSize: 11, color: MUTED, letterSpacing: '0.12em', textTransform: 'uppercase' }}>or</span>
          <div style={{ flex: 1, height: 1, background: LINE }} />
        </div>

        {/* Option 2: Connect your own bot */}
        <div className="fade-up delay-2" style={{ marginTop: 4 }}>
          <button
            onClick={() => { onTrack?.('connect_custom'); setMode('custom'); }}
            style={{
              width: '100%', background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 16,
              padding: '18px', textAlign: 'left', cursor: 'pointer', fontFamily: BODY,
              display: 'flex', gap: 14, alignItems: 'flex-start',
              transition: 'border-color .15s ease',
            }}
          >
            <span style={{
              width: 40, height: 40, borderRadius: 11, flexShrink: 0,
              background: 'rgba(176,138,74,0.1)', display: 'grid', placeItems: 'center',
            }}>
              <LineIcon name="bot" color={GOLD} size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Connect your own bot</div>
              <div style={{ fontSize: 13, color: '#4A5E5A', marginTop: 4, lineHeight: 1.45 }}>
                Create a bot via @BotFather and get your own @YourShopBot username. Takes 2 minutes.
              </div>
            </div>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 4, flexShrink: 0 }}>
              <path d="M9 6l6 6-6 6"/>
            </svg>
          </button>
        </div>

        {err && (
          <div style={{ marginTop: 14, background: 'rgba(184,84,80,0.08)', border: '1px solid rgba(184,84,80,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: ERROR, fontFamily: BODY }}>
            {err}
          </div>
        )}
      </Shell>
    );
  }

  // ─── Custom bot flow (BotFather token) ─────────────────────────────────
  return (
    <Shell step={3} total={4} onBack={() => setMode('')} onNext={connect} ctaLabel="Connect bot"
           disabled={!valid} busy={busy} secondaryLabel="Use MiniMe directly instead" onSecondary={() => setMode('')}>
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
          Step two · connect your bot
        </div>
        <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
          Connect your <span style={{ fontStyle: 'italic' }}>bot</span>.
        </div>
        <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.45 }}>
          You need a Telegram bot to receive and reply to messages. Creating one is free and takes 2 minutes.
        </p>
      </div>

      {/* How to create a bot */}
      <div className="fade-up delay-1" style={{ marginTop: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>
          How to create your bot
        </div>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            {
              n: '01',
              title: 'Open @BotFather in Telegram',
              body: 'BotFather is Telegram\'s official bot creator. Tap the button below to open it.',
              action: { label: 'Open @BotFather →', href: 'https://t.me/BotFather' },
            },
            {
              n: '02',
              title: 'Send /newbot',
              body: 'Type /newbot and send it. BotFather will ask for a display name (e.g. "Selam Shop") then a username ending in "bot" (e.g. selamshopbot).',
            },
            {
              n: '03',
              title: 'Copy your token',
              body: 'BotFather will reply with a long token like 1234567890:AAHd-... — copy the whole thing and paste it below.',
            },
          ].map((s, i) => (
            <li key={s.n} style={{ display: 'flex', gap: 14, paddingBottom: i < 2 ? 14 : 0, borderBottom: i < 2 ? `1px solid ${LINE}` : 'none', marginBottom: i < 2 ? 14 : 0 }}>
              <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 20, color: GOLD, minWidth: 26, lineHeight: 1.2 }}>{s.n}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: INK, lineHeight: 1.2 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: '#4A5E5A', marginTop: 4, lineHeight: 1.45 }}>{s.body}</div>
                {s.action && (
                  <a
                    href={s.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block', marginTop: 8,
                      fontSize: 13, fontWeight: 600, color: GOLD, textDecoration: 'none',
                      background: 'rgba(176,138,74,0.1)', padding: '6px 12px', borderRadius: 999,
                    }}
                  >{s.action.label}</a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="fade-up delay-2" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <label style={{ fontSize: 12, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>
            Paste your bot token
          </label>
          <button
            type="button"
            onClick={pasteFromClipboard}
            style={{
              appearance: 'none', border: `1px solid ${GOLD}`, background: 'rgba(176,138,74,0.08)',
              color: GOLD, fontFamily: BODY, fontSize: 12.5, fontWeight: 600,
              padding: '6px 14px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Paste token
          </button>
        </div>
        <input
          type="password"
          autoComplete="off"
          placeholder="1234567890:AAHd-…"
          value={token}
          onChange={e => setToken(e.target.value)}
          style={{ marginTop: 8, fontFamily: MONO, fontSize: 16, letterSpacing: '0.02em' }}
        />
        {pasteErr && (
          <div style={{ marginTop: 8, fontSize: 12, color: MUTED, fontFamily: BODY, lineHeight: 1.45 }}>
            {pasteErr}
          </div>
        )}
        {valid && (
          <div className="fade-in" style={{ marginTop: 8, color: MINT, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={MINT} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l4 4 10-10"/>
            </svg>
            Token looks valid
          </div>
        )}
        {err && (
          <div style={{ marginTop: 10, background: 'rgba(184,84,80,0.08)', border: '1px solid rgba(184,84,80,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: ERROR, fontFamily: BODY }}>
            {err}
          </div>
        )}
        <p style={{ fontFamily: BODY, fontSize: 11, color: MUTED, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <LineIcon name="lock" color={MUTED} size={13} strokeWidth={1.5} />
          Encrypted at rest — never stored in plain text.
        </p>
      </div>
    </Shell>
  );
}

// ─── Welcome screen (dark) ───────────────────────────────────────────────────
function Welcome({ onNext }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: INK, color: PAPER,
      display: 'flex', flexDirection: 'column', fontFamily: BODY,
    }}>
      <div className="grain" />

      {/* Scrollable content area — button always reachable */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 'max(52px, env(safe-area-inset-top))',
        paddingLeft: 28,
        paddingRight: 28,
        paddingBottom: 0,
      }}>
        <div className="fade-up" style={{ marginBottom: 8 }}>
          <MiniMeLogo size={50} color={CREAM} accent={GOLDSF} />
        </div>

        <div style={{ flex: 1 }}>
          <div className="fade-up delay-1" style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: GOLDSF, marginTop: 20,
          }}>
            እንኳን ደህና መጡ · welcome
          </div>

          <div className="fade-up delay-2" style={{
            fontFamily: SERIF, fontWeight: 400, fontSize: 38, color: PAPER,
            marginTop: 10, lineHeight: 1.05, letterSpacing: '-0.02em',
          }}>
            Your business,<br />
            <span style={{ fontStyle: 'italic', color: GOLDSF }}>handled.</span>
          </div>

          <p className="fade-up delay-3" style={{
            fontSize: 14, color: 'rgba(244,238,225,0.7)', marginTop: 14,
            lineHeight: 1.55,
          }}>
            An AI assistant that answers your customers on Telegram — in your voice, day and night.
          </p>

          {/* What you get */}
          <div className="fade-up delay-4" style={{ marginTop: 24 }}>
            {[
              { icon: 'reply',  text: 'AI replies to customers in your voice, 24/7' },
              { icon: 'tag',    text: 'Handles orders, prices & product questions' },
              { icon: 'learn',  text: 'Learns from every conversation' },
              { icon: 'shield', text: 'You stay in control — approve or edit any reply' },
            ].map((f, i) => (
              <div key={i} style={{
                display: 'flex', gap: 14, alignItems: 'center',
                padding: '13px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(244,238,225,0.1)',
              }}>
                <LineIcon name={f.icon} color={GOLDSF} size={19} strokeWidth={1.3} />
                <span style={{ fontSize: 13.5, color: 'rgba(244,238,225,0.78)', lineHeight: 1.4 }}>{f.text}</span>
              </div>
            ))}
          </div>

          {/* One quiet reassurance + a link out for anyone who wants the full pitch. */}
          <Link href="/demo" className="fade-up delay-4" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 26,
            fontSize: 13, fontWeight: 600, color: GOLDSF, textDecoration: 'none',
          }}>
            See how it works →
          </Link>
        </div>

        {/* CTA — always visible at bottom of scroll */}
        <div className="fade-up delay-4" style={{
          paddingTop: 24,
          paddingBottom: 'max(28px, env(safe-area-inset-bottom))',
          position: 'sticky',
          bottom: 0,
          background: INK,
          marginLeft: -28,
          marginRight: -28,
          paddingLeft: 28,
          paddingRight: 28,
        }}>
          <button
            onClick={onNext}
            style={{
              width: '100%', appearance: 'none', border: 0,
              background: PAPER, color: INK,
              padding: '16px', borderRadius: 999,
              fontSize: 15, fontWeight: 500, cursor: 'pointer',
              fontFamily: BODY, letterSpacing: '-0.01em',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              touchAction: 'manipulation',
            }}
          >
            Set up in 90 seconds
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { initData, business, setBusiness, telegramUser, loading, error: authError } = useTelegram() || {};

  // Replay mode: owner tapped "Replay walkthrough" in Settings. We show the full
  // wizard again as a non-destructive tour — no redirect-away, no live mutations.
  const preview = searchParams?.get('preview') === '1';

  const [screen, setScreen] = useState('loader');
  const [onb, setOnb]       = useState({ name: '', category: '', description: '', sells: '' });
  const [saveErr, setSaveErr] = useState('');
  const [saving, setSaving]   = useState(false);

  // ── Resume across the BotFather app-switch ──────────────────────────────────
  // Creating a bot means LEAVING MiniMe (to @BotFather) and coming back — which
  // reloads this Mini App and wipes pure client state. That round-trip was the
  // single biggest reason owners never finished linking their own bot: they
  // returned to a fresh wizard, couldn't find the paste field, and bailed to
  // shared mode. We snapshot {screen, answers} to localStorage so a return lands
  // them right back on the connect step with everything intact.
  const VALID_RESUME = ['welcome', 'sell', 'demo', 'teach', 'connect'];
  const resumeRef = useRef(null);
  const clearResume = useCallback(() => { try { localStorage.removeItem(ONB_RESUME_KEY); } catch {} }, []);
  useEffect(() => {
    if (preview) return;
    try {
      const saved = JSON.parse(localStorage.getItem(ONB_RESUME_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (VALID_RESUME.includes(saved.screen)) resumeRef.current = saved.screen;
        if (saved.onb && typeof saved.onb === 'object') setOnb(o => ({ ...o, ...saved.onb }));
      }
    } catch {}
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (preview || screen === 'loader') return;
    try { localStorage.setItem(ONB_RESUME_KEY, JSON.stringify({ screen, onb })); } catch {}
  }, [screen, onb, preview]);

  // Auth is finished once loading is false (regardless of whether initData or error)
  const authReady = !loading;

  // ── Funnel telemetry ────────────────────────────────────────────────────────
  // Fire-and-forget one row per step the FIRST time it's reached this session.
  // This is the only window we have into where owners abandon — the wizard is
  // pure client state, so without this we're blind on every screen before the
  // very end. Never tracks in preview (replay) mode. Deduped per session so a
  // re-render or a back-then-forward doesn't double-count.
  const trackedRef = useRef(new Set());
  const track = useCallback((step) => {
    if (preview || !initData || !step) return;
    if (trackedRef.current.has(step)) return;
    trackedRef.current.add(step);
    fetch('/api/onboarding/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ step }),
    }).catch(() => {});
  }, [preview, initData]);

  // Track every wizard screen as it's shown (skip the loader splash). Re-runs
  // when initData lands so the earliest screens still register once auth completes.
  useEffect(() => {
    if (screen && screen !== 'loader') track(screen);
  }, [screen, track]);

  useEffect(() => {
    if (loading) return;
    // In replay/preview mode, never bounce away — let the owner re-watch the flow.
    if (!preview && isOnboarded(business)) { clearResume(); router.replace('/'); return; }
    // Pre-fill the name so most owners can just tap Continue — zero typing.
    if (business?.name) setOnb(o => ({ ...o, name: o.name || business.name }));
    else if (telegramUser?.first_name) setOnb(o => ({ ...o, name: o.name || telegramUser.first_name }));
  }, [loading, business, telegramUser, router, preview]);

  // ── Native Telegram back button across the wizard ──────────────────────────
  // The dashboard shell omits its global back button while onboarding renders
  // (this is a bare full-screen wizard), so drive Telegram's BackButton here
  // from the wizard's own step state — it steps back through the flow and hides
  // on the first screens. No-ops cleanly in a plain browser (no Telegram.WebApp),
  // where the in-page chevron and browser chrome still work.
  useEffect(() => {
    const wa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const bb = wa?.BackButton;
    if (!bb) return;
    const prev = { sell: 'welcome', demo: 'sell', teach: 'demo', connect: 'teach' };
    const target = prev[screen];
    const handler = () => { if (target) setScreen(target); };
    try {
      if (target) { bb.show(); bb.onClick(handler); }
      else { bb.hide(); }
    } catch {}
    return () => { try { bb.offClick(handler); } catch {} };
  }, [screen]);

  async function saveBusiness() {
    // Replay/preview mode: don't overwrite the live business — just advance.
    if (preview) return;
    // We no longer ask for a business name up front (it's friction). Derive one:
    // existing name → Telegram first name → what-they-sell → safe default.
    const finalName =
      (onb.name || '').trim() ||
      (telegramUser?.first_name || '').trim() ||
      (onb.sells || '').trim().slice(0, 40) ||
      'My Business';
    if (!initData) {
      // Auth hasn't completed — shouldn't be reachable but guard anyway
      setSaveErr('Authentication not ready. Please close and re-open the app.');
      return;
    }
    setSaving(true); setSaveErr('');
    // The price list seeds the catalog; if they skipped it, fall back to the
    // one-line "what you sell" so the business still has a description/brief.
    const teachText = (onb.description || '').trim() || (onb.sells || '').trim();
    try {
      const r = await fetch('/api/onboarding/business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ name: finalName, workspace_type: 'business', category: onb.category || 'other', description: teachText || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error || `Save failed (${r.status})`);
      }
      // Refresh context so subsequent steps see the persisted business
      if (j?.business && setBusiness) setBusiness(j.business);

      // Turn the price list into real catalog products. Fire-and-forget so
      // onboarding stays instant — by the time they finish connecting, the
      // products (and the searchable brief) are in. This is what makes the
      // assistant actually able to quote prices and take orders from minute one.
      if (teachText) {
        fetch('/api/teach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ description: teachText }),
        }).catch(() => {});
      }
    } catch (e) {
      setSaveErr(e.message);
      setSaving(false);
      throw e; // re-throw so the caller (onNext) doesn't advance
    }
    setSaving(false);
  }

  if (screen === 'loader') return <Loader authReady={authReady} onDone={() => setScreen(resumeRef.current || 'welcome')} />;
  if (screen === 'welcome') return <Welcome onNext={() => setScreen('sell')} />;
  if (screen === 'sell') return (
    <StepSell
      value={onb} setValue={setOnb}
      onBack={() => setScreen('welcome')}
      onNext={() => setScreen('demo')}
    />
  );
  if (screen === 'demo') return (
    <StepDemo
      sells={onb.sells}
      onBack={() => setScreen('sell')}
      onNext={() => setScreen('teach')}
    />
  );
  if (screen === 'teach') return (
    <>
      <StepTeach
        value={onb} setValue={setOnb}
        onBack={() => setScreen('demo')}
        onNext={async () => {
          try { await saveBusiness(); setScreen('connect'); }
          catch {} // error already set in saveErr, stay on screen
        }}
        busy={saving}
      />
      {saveErr && (
        <div style={{
          position: 'fixed', bottom: 120, left: 20, right: 20, zIndex: 999,
          background: '#B85450', color: '#FFF', borderRadius: 10, padding: '12px 16px',
          fontSize: 13, fontFamily: "'Geist', sans-serif", textAlign: 'center',
        }}>
          {saveErr}
        </div>
      )}
    </>
  );
  if (screen === 'connect') return (
    <StepConnect
      initData={initData}
      setBusiness={setBusiness}
      preview={preview}
      onTrack={track}
      onBack={() => setScreen('teach')}
      onNext={() => { clearResume(); router.replace('/'); }}
      onSkip={() => { clearResume(); router.replace('/'); }}
    />
  );

  return null;
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingInner />
    </Suspense>
  );
}
