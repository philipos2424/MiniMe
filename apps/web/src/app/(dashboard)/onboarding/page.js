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

// CATEGORIES removed — the conversational interview infers category from the
// owner's free-text answers; no more manual picker.

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

// ─── Step 0: The conversation ───────────────────────────────────────────────
// The first half of the wizard. MiniMe asks tailored questions one at a time;
// the owner answers in natural language. Every answer is piped through the
// teaching pipeline server-side, so by the time they reach Step 1 (Try It)
// their products + brief are already in the DB and the AI can quote them.
//
// State lives mostly on the server (notification_prefs.onboarding_chat) so
// the wizard is resumable across the BotFather app-switch / a refresh.
function StepConversation({ initData, onDone, onBack, onTrack }) {
  // Chat buffer: each entry is { who: 'mini'|'you'|'toast', text }. Toasts are
  // server feedback ("✅ 2 products added") rendered as soft pills, not bubbles.
  const [chat, setChat]   = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  const [turn, setTurn]   = useState(0);
  const [maxTurns, setMaxTurns] = useState(5);
  const [captured, setCaptured] = useState({});
  const [productsTotal, setProductsTotal] = useState(0);
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);
  const listRef = useRef(null);

  // Kick off with the seed question. The server tracks state, so re-entry
  // (back/forward, refresh) just replays the current pending question — the
  // owner's prior answers are still captured.
  useEffect(() => {
    if (startedRef.current || !initData) return;
    startedRef.current = true;
    onTrack?.('conversation_started');
    (async () => {
      try {
        const r = await fetch('/api/onboarding/interview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({}),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `start_failed`);
        setChat([{ who: 'mini', text: j.question }]);
        setTurn(j.turn || 0);
        setMaxTurns(j.max_turns || 5);
        setCaptured(j.captured || {});
        setProductsTotal(j.total_products || 0);
      } catch (e) {
        setErr(e.message || 'Could not start the conversation.');
      }
    })();
  }, [initData, onTrack]);

  // Autoscroll to newest message after each render.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [chat, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy || done) return;
    setErr('');
    setBusy(true);
    setInput('');
    setChat(c => [...c, { who: 'you', text }]);
    try {
      const r = await fetch('/api/onboarding/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ message: text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'send_failed');
      const newToasts = [];
      if (j.products_added > 0) {
        newToasts.push({ who: 'toast', text: `✅ ${j.products_added} product${j.products_added === 1 ? '' : 's'} added to your catalog.` });
      }
      setProductsTotal(j.total_products || productsTotal);
      setCaptured(j.captured || captured);
      setTurn(j.turn || turn);
      // Server returns either the next question (continue) or done:true (advance).
      if (j.done) {
        setChat(c => [...c, ...newToasts, { who: 'mini', text: "🎉 You're set up. Let's see me in action — try me as a customer next." }]);
        setDone(true);
        onTrack?.('conversation_finished');
      } else {
        setChat(c => [...c, ...newToasts, { who: 'mini', text: j.question }]);
      }
    } catch (e) {
      setErr(e.message || 'Could not send. Try again.');
      // Restore the input so a network blip doesn't lose what they typed.
      setInput(text);
      // Drop the optimistic "you" bubble we just added — it was never sent.
      setChat(c => c.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  // Visible chips: only the ones we've actually captured. Empty when fresh.
  const chips = [
    captured.catalog || productsTotal > 0 ? { label: `Catalog · ${productsTotal}`, on: true } : null,
    captured.delivery ? { label: 'Delivery', on: true } : null,
    captured.voice    ? { label: 'Voice', on: true } : null,
    captured.faq      ? { label: 'FAQ', on: true } : null,
  ].filter(Boolean);

  return (
    <div style={{ position: 'fixed', inset: 0, background: PAPER, display: 'flex', flexDirection: 'column', fontFamily: BODY, color: INK }}>
      {/* Top bar — same chrome as Shell, but with chips instead of dot-progress */}
      <div style={{ padding: 'max(14px, env(safe-area-inset-top)) 22px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={onBack} style={{ border: 0, background: 'transparent', padding: 6, cursor: 'pointer', lineHeight: 1 }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6"/>
          </svg>
        </button>
        <div style={{ fontSize: 11, color: MUTED, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          {done ? 'Done' : `Step ${Math.min(turn + 1, maxTurns)} of ${maxTurns}`}
        </div>
        <div style={{ width: 34 }} />
      </div>

      {/* Captured-state chips */}
      {chips.length > 0 && (
        <div style={{ padding: '10px 22px 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map(c => (
            <span key={c.label} style={{
              fontSize: 11, color: MINT, background: 'rgba(79,163,138,0.1)',
              padding: '3px 10px', borderRadius: 999, fontWeight: 500,
            }}>{c.label}</span>
          ))}
        </div>
      )}

      {/* Chat body */}
      <div ref={listRef} style={{
        flex: 1, padding: '18px 22px 24px', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0,
      }}>
        {chat.length === 0 && !err && (
          <div style={{ color: MUTED, fontSize: 13, textAlign: 'center', marginTop: 32 }}>
            Connecting to MiniMe…
          </div>
        )}
        {chat.map((m, i) => {
          if (m.who === 'toast') {
            return (
              <div key={i} className="fade-up" style={{ alignSelf: 'center', maxWidth: '90%' }}>
                <div style={{
                  background: 'rgba(79,163,138,0.1)', color: MINT, fontSize: 12, fontWeight: 500,
                  border: `1px solid rgba(79,163,138,0.25)`, borderRadius: 999, padding: '5px 12px',
                }}>
                  {m.text}
                </div>
              </div>
            );
          }
          const isMini = m.who === 'mini';
          return (
            <div key={i} className="fade-up" style={{ alignSelf: isMini ? 'flex-start' : 'flex-end', maxWidth: '86%' }}>
              {isMini && <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 4, marginLeft: 4 }}>MiniMe</div>}
              <div style={{
                background: isMini ? '#fff' : MINT,
                border: isMini ? `1px solid ${LINE}` : 'none',
                color: isMini ? INK : '#fff',
                borderRadius: isMini ? '4px 16px 16px 16px' : '16px 16px 4px 16px',
                padding: '11px 15px', fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-wrap',
              }}>
                {m.text}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="fade-up" style={{ alignSelf: 'flex-start', color: MUTED, fontSize: 12 }}>
            MiniMe is thinking…
          </div>
        )}
        {err && (
          <div style={{ alignSelf: 'center', background: 'rgba(184,84,80,0.08)', border: '1px solid rgba(184,84,80,0.25)', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, color: ERROR }}>
            {err}
          </div>
        )}
      </div>

      {/* Footer: input (or CTA when done) */}
      <div style={{ padding: '12px 22px', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', borderTop: `1px solid ${LINE}`, background: PAPER }}>
        {done ? (
          <button
            onClick={onDone}
            style={{
              width: '100%', appearance: 'none', border: 0, background: INK, color: PAPER,
              padding: '16px', borderRadius: 999, fontSize: 15, fontWeight: 500, fontFamily: BODY,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            Try MiniMe on my catalog
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={PAPER} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7"/>
            </svg>
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              placeholder={turn === 0 ? 'Tell MiniMe about your business…' : 'Your answer…'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              autoFocus
              disabled={busy}
              style={{
                flex: 1, resize: 'none', appearance: 'none',
                border: `1px solid ${LINE}`, borderRadius: 18, padding: '11px 14px',
                fontSize: 15, fontFamily: BODY, color: INK, background: '#fff', outline: 'none',
                minHeight: 42, maxHeight: 140, lineHeight: 1.4,
              }}
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              style={{
                appearance: 'none', border: 0, borderRadius: 999,
                width: 42, height: 42, flexShrink: 0,
                background: busy || !input.trim() ? '#C8C0B8' : INK, color: PAPER,
                cursor: busy || !input.trim() ? 'default' : 'pointer',
                display: 'grid', placeItems: 'center',
              }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={PAPER} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 1: Try it — owner messages as a customer ─────────────────────────
// The "feel the value" moment. Owner types a customer-style question; MiniMe
// answers using their REAL catalog/brief via /api/onboarding/preview. If a
// reply isn't quite right, they tap ✏️ Edit and the corrected text is saved
// as a durable FAQ pair (so the AI gets smarter ON THE SPOT, not later).
function StepTryIt({ initData, onNext, onBack, onTrack }) {
  // Each entry: { who: 'mini'|'you', text, conv?, original?, edited?: bool, busy?: bool }
  const [chat, setChat]       = useState([]);
  const [input, setInput]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [prompts, setPrompts] = useState([]);
  const [hasTried, setHasTried] = useState(false);
  const listRef = useRef(null);

  // Pull suggested prompts from the owner's real catalog (built server-side).
  useEffect(() => {
    if (!initData) return;
    (async () => {
      try {
        const r = await fetch('/api/onboarding/suggest-prompts', {
          headers: { 'x-telegram-init-data': initData },
          cache: 'no-store',
        });
        const j = await r.json();
        if (Array.isArray(j.prompts)) setPrompts(j.prompts);
      } catch { /* non-fatal — the input still works */ }
    })();
  }, [initData]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [chat, busy]);

  async function send(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setErr('');
    setBusy(true);
    if (!textOverride) setInput('');
    setChat(c => [...c, { who: 'you', text }]);
    onTrack?.('tryit_sent');
    try {
      const r = await fetch('/api/onboarding/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ message: text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'preview_failed');
      const reply = j.reply || j.hint || "I don't have enough to answer that yet — try teaching me first.";
      setChat(c => [...c, { who: 'mini', text: reply, conv: j.conversation_id, original: reply }]);
      setHasTried(true);
      onTrack?.('tryit_replied');
    } catch (e) {
      setErr(e.message || 'No reply. Try again.');
      setChat(c => c.slice(0, -1));
      if (!textOverride) setInput(text);
    } finally {
      setBusy(false);
    }
  }

  // Saves the edited text as a durable FAQ pair (server: /api/onboarding/edit-reply).
  async function saveEdit(idx, correctedText) {
    const entry = chat[idx];
    if (!entry || !entry.conv) return;
    const corrected = correctedText.trim();
    if (corrected.length < 4 || corrected === entry.original) return;
    try {
      const r = await fetch('/api/onboarding/edit-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ conversation_id: entry.conv, corrected_text: corrected }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'edit_failed');
      setChat(c => c.map((m, i) => i === idx ? { ...m, text: corrected, edited: true } : m));
      onTrack?.('tryit_edited');
    } catch (e) {
      setErr(e.message || 'Could not save your edit.');
    }
  }

  return (
    <Shell step={1} total={3} onBack={onBack} onNext={onNext}
           ctaLabel={hasTried ? 'Looking good →' : 'Try me first'} disabled={!hasTried}
           secondaryLabel="Skip for now" onSecondary={onNext}>
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>Try it</div>
        <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.12 }}>
          Message me like a <span style={{ fontStyle: 'italic' }}>customer</span>.
        </div>
        <p style={{ fontSize: 14, color: '#4A5E5A', marginTop: 8, lineHeight: 1.45 }}>
          Ask about prices, delivery, anything. If a reply isn't right, tap ✏️ to fix it — I'll remember.
        </p>
      </div>

      {/* Chat thread */}
      <div ref={listRef} style={{
        marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12,
        flex: 1, minHeight: 0, overflowY: 'auto',
      }}>
        {chat.length === 0 && prompts.length > 0 && (
          <div className="fade-up" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {prompts.map(p => (
              <button
                key={p}
                onClick={() => send(p)}
                disabled={busy}
                style={{
                  appearance: 'none', border: `1px solid ${LINE}`, background: '#fff', color: INK,
                  borderRadius: 999, padding: '8px 14px', fontSize: 13, fontFamily: BODY,
                  cursor: busy ? 'default' : 'pointer',
                }}>
                {p}
              </button>
            ))}
          </div>
        )}
        {chat.map((m, i) => {
          const isMini = m.who === 'mini';
          return (
            <div key={i} style={{ alignSelf: isMini ? 'flex-start' : 'flex-end', maxWidth: '88%' }}>
              {isMini && <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 4, marginLeft: 4 }}>MiniMe</div>}
              <div style={{
                background: isMini ? '#fff' : MINT, border: isMini ? `1px solid ${LINE}` : 'none',
                color: isMini ? INK : '#fff',
                borderRadius: isMini ? '4px 16px 16px 16px' : '16px 16px 4px 16px',
                padding: '11px 15px', fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-wrap',
              }}>
                {m.text}
              </div>
              {isMini && m.conv && !m.edited && (
                <EditAffordance original={m.text} onSave={txt => saveEdit(i, txt)} />
              )}
              {isMini && m.edited && (
                <div style={{ marginTop: 4, marginLeft: 4, fontSize: 11, color: MINT }}>
                  ✓ Saved — MiniMe will use your wording next time.
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="fade-up" style={{ alignSelf: 'flex-start', color: MUTED, fontSize: 12 }}>
            MiniMe is typing…
          </div>
        )}
        {err && (
          <div style={{ alignSelf: 'center', background: 'rgba(184,84,80,0.08)', border: '1px solid rgba(184,84,80,0.25)', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, color: ERROR }}>
            {err}
          </div>
        )}
      </div>

      {/* Inline composer (not in footer — Shell already owns the CTA below) */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          placeholder="Type a question a customer might ask…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          disabled={busy}
          style={{
            flex: 1, resize: 'none', appearance: 'none',
            border: `1px solid ${LINE}`, borderRadius: 18, padding: '10px 14px',
            fontSize: 14.5, fontFamily: BODY, color: INK, background: '#fff', outline: 'none',
            minHeight: 40, maxHeight: 120, lineHeight: 1.4,
          }}
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          style={{
            appearance: 'none', border: 0, borderRadius: 999,
            width: 40, height: 40, flexShrink: 0,
            background: busy || !input.trim() ? '#C8C0B8' : INK, color: PAPER,
            cursor: busy || !input.trim() ? 'default' : 'pointer',
            display: 'grid', placeItems: 'center',
          }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={PAPER} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7"/>
          </svg>
        </button>
      </div>
    </Shell>
  );
}

// ─── Inline edit affordance for a MiniMe reply ──────────────────────────────
// Two states: collapsed (just the pencil link) and expanded (textarea + Save).
// Kept here vs. promoted to a shared component because no other surface in the
// app currently lets you edit a draft inline — if a second use emerges, lift.
function EditAffordance({ original, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(original);
  if (!editing) {
    return (
      <button
        onClick={() => { setText(original); setEditing(true); }}
        style={{
          marginTop: 4, marginLeft: 4, appearance: 'none', border: 0, background: 'transparent',
          color: MUTED, fontSize: 11.5, cursor: 'pointer', fontFamily: BODY,
        }}>
        ✏️ Fix this reply
      </button>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        autoFocus
        style={{
          width: '100%', resize: 'vertical', appearance: 'none',
          border: `1px solid ${GOLD}`, borderRadius: 12, padding: '8px 12px',
          fontSize: 13.5, fontFamily: BODY, color: INK, background: '#fff', outline: 'none', lineHeight: 1.45,
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button
          onClick={() => { onSave(text); setEditing(false); }}
          style={{
            appearance: 'none', border: 0, borderRadius: 999, background: INK, color: PAPER,
            padding: '6px 14px', fontSize: 12, fontWeight: 600, fontFamily: BODY, cursor: 'pointer',
          }}>
          Save fix
        </button>
        <button
          onClick={() => setEditing(false)}
          style={{
            appearance: 'none', border: `1px solid ${LINE}`, background: 'transparent', color: MUTED,
            borderRadius: 999, padding: '6px 14px', fontSize: 12, fontFamily: BODY, cursor: 'pointer',
          }}>
          Cancel
        </button>
      </div>
    </div>
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
            <div style={{ fontFamily: SERIF, fontSize: 30, marginTop: 16, color: INK, letterSpacing: '-0.015em' }}>Share your storefront.</div>
            <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.5 }}>
              MiniMe is live. Send this link to your friends and customers — they can start chatting with your AI right now.
            </p>
          </div>

          {/* Deep link card — prominent, above the fold */}
          <div className="fade-up delay-1" style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
              Your storefront link
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

          {/* Share buttons — Telegram + WhatsApp */}
          <div className="fade-up delay-2" style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent('Check out my shop!')}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onTrack?.('shared_share_tapped')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                appearance: 'none', border: `1.5px solid #29A8E8`, background: 'rgba(41,168,232,0.08)',
                color: '#29A8E8', borderRadius: 999, padding: '12px 14px',
                fontSize: 14, fontWeight: 600, fontFamily: BODY, textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="#29A8E8"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
              Share on Telegram
            </a>
            <a
              href={`https://wa.me/?text=${encodeURIComponent('Check out my shop! ' + deepLink)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onTrack?.('shared_share_tapped')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                appearance: 'none', border: `1.5px solid #25D366`, background: 'rgba(37,211,102,0.08)',
                color: '#25D366', borderRadius: 999, padding: '12px 14px',
                fontSize: 14, fontWeight: 600, fontFamily: BODY, textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Share on WhatsApp
            </a>
          </div>

          {/* Phone capture — high-intent moment, optional */}
          <PhoneCapture initData={initData} preview={preview} />

          {/* Next steps */}
          <div className="fade-up delay-3" style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 4 }}>
              What's next
            </div>
            <NumberedSteps items={[
              {
                title: 'Keep teaching MiniMe',
                body: 'Message @MiniMeAgentBot with text, photos, files, or voice notes — the more you teach, the better it replies.',
              },
              {
                title: 'Share your link everywhere',
                body: 'Put your storefront link in your Instagram bio, Facebook page, and WhatsApp status. Customers tap it and start chatting.',
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
      <Shell step={2} total={3} onBack={onBack} onNext={activateSharedMode} ctaLabel="Use MiniMe directly"
             disabled={false} busy={busy}>
        <div className="fade-up">
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
            Last step
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
    <Shell step={2} total={3} onBack={() => setMode('')} onNext={connect} ctaLabel="Connect bot"
           disabled={!valid} busy={busy} secondaryLabel="Use MiniMe directly instead" onSecondary={() => setMode('')}>
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
          Connect your bot
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
  const { initData, business, setBusiness, loading, error: authError } = useTelegram() || {};

  // Replay mode: owner tapped "Replay walkthrough" in Settings. We show the full
  // wizard again as a non-destructive tour — no redirect-away, no live mutations.
  const preview = searchParams?.get('preview') === '1';

  const [screen, setScreen] = useState('loader');

  // ── Resume across the BotFather app-switch ──────────────────────────────────
  // Creating a bot means LEAVING MiniMe (to @BotFather) and coming back — which
  // reloads this Mini App and wipes pure client state. That round-trip was the
  // single biggest reason owners never finished linking their own bot: they
  // returned to a fresh wizard, couldn't find the paste field, and bailed to
  // shared mode. We snapshot {screen, answers} to localStorage so a return lands
  // them right back on the connect step with everything intact.
  const VALID_RESUME = ['welcome', 'conversation', 'tryit', 'connect'];
  const resumeRef = useRef(null);
  const clearResume = useCallback(() => { try { localStorage.removeItem(ONB_RESUME_KEY); } catch {} }, []);
  useEffect(() => {
    if (preview) return;
    try {
      const saved = JSON.parse(localStorage.getItem(ONB_RESUME_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (VALID_RESUME.includes(saved.screen)) resumeRef.current = saved.screen;
      }
    } catch {}
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (preview || screen === 'loader') return;
    try { localStorage.setItem(ONB_RESUME_KEY, JSON.stringify({ screen })); } catch {}
  }, [screen, preview]);

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
  }, [loading, business, router, preview, clearResume]);

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
    const prev = { conversation: 'welcome', tryit: 'conversation', connect: 'tryit' };
    const target = prev[screen];
    const handler = () => { if (target) setScreen(target); };
    try {
      if (target) { bb.show(); bb.onClick(handler); }
      else { bb.hide(); }
    } catch {}
    return () => { try { bb.offClick(handler); } catch {} };
  }, [screen]);

  // saveBusiness is no longer needed — the /api/onboarding/interview endpoint
  // lazily creates the business on the first turn of the conversation. By the
  // time the owner reaches Connect, their business + products already exist.

  if (screen === 'loader') return <Loader authReady={authReady} onDone={() => setScreen(resumeRef.current || 'welcome')} />;
  if (screen === 'welcome') return <Welcome onNext={() => setScreen('conversation')} />;
  if (screen === 'conversation') return (
    <StepConversation
      initData={initData}
      onDone={() => setScreen('tryit')}
      onBack={() => setScreen('welcome')}
      onTrack={track}
    />
  );
  if (screen === 'tryit') return (
    <StepTryIt
      initData={initData}
      onNext={() => setScreen('connect')}
      onBack={() => setScreen('conversation')}
      onTrack={track}
    />
  );
  if (screen === 'connect') return (
    <StepConnect
      initData={initData}
      setBusiness={setBusiness}
      preview={preview}
      onTrack={track}
      onBack={() => setScreen('tryit')}
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
