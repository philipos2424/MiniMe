'use client';
import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTelegram } from '../../../context/TelegramContext';
import { isOnboarded } from '../../../lib/onboarding-status';
import { extractToken, isValidBotToken, friendlyLinkError } from '../../../lib/botToken';
import { uploadProduct, isImage } from '../../../lib/uploadProduct';
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

// ─── Step 0a: Shop name (pre-step) ──────────────────────────────────────────
// A tiny single-field screen that runs BEFORE the customer chat. Selam's first
// message references the shop name verbatim ("hi! is this Habesha Leather?
// what do you have?"), so we capture it up front rather than asking inside the
// chat (which would break immersion — no real customer asks "what's your
// business called" as the opener).
//
// POSTs to /api/onboarding/business (idempotent — accepts a name-only update,
// lazy-creates the business row if it doesn't exist yet).
function StepShopName({ initData, onDone, onBack, onTrack }) {
  const [value, setValue] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  // Rotating example placeholders — light nudge that this is a SHOP name,
  // not their personal name. Cycles on a slow timer so it doesn't distract.
  const examples = ['Habesha Leather Works', 'Mama\'s Catering', 'Selam Boutique', 'Addis Electronics'];
  const [phIdx, setPhIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhIdx(i => (i + 1) % examples.length), 2400);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onTrack?.('shop_name'); }, [onTrack]);

  async function submit() {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/onboarding/business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ name }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'save_failed');
      onTrack?.('shop_name_saved');
      onDone(name);
    } catch (e) {
      setErr(e.message || 'Could not save. Try again.');
      setBusy(false);
    }
  }

  return (
    <Shell step={0} total={3} onBack={onBack} onNext={submit}
           ctaLabel="Next" disabled={!value.trim()} busy={busy}>
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>Your shop</div>
        <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.12 }}>
          What's the name of your <span style={{ fontStyle: 'italic' }}>shop</span>?
        </div>
        <p style={{ fontSize: 14, color: '#4A5E5A', marginTop: 8, lineHeight: 1.45 }}>
          Your first customer is about to message you.
        </p>
      </div>

      <div style={{ marginTop: 28 }}>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder={examples[phIdx]}
          autoFocus
          maxLength={80}
          style={{
            width: '100%', appearance: 'none',
            border: 'none', borderBottom: `1.5px solid ${LINE}`,
            background: 'transparent', color: INK, fontFamily: SERIF, fontSize: 24,
            padding: '10px 0 10px', outline: 'none',
          }}
        />
        {err && (
          <div style={{ marginTop: 14, fontSize: 12.5, color: ERROR }}>{err}</div>
        )}
      </div>
    </Shell>
  );
}

// ─── Step 0b: The customer chat (Selam) ─────────────────────────────────────
// The owner is dropped into an active Telegram-style chat with **Selam**, a
// fictional first-time customer. Selam opens with something like
// "hi! is this Habesha Leather? what do you have?". The owner replies the
// way they'd reply to any real shopper. MiniMe watches silently:
//   - Pipes each owner reply through teachFromText → products + brief
//   - Extracts the owner's REAL customer-facing voice → voice_embedding
//   - Returns short "captured_items" tags that we render as inline mint chips
//     directly under the owner's just-sent bubble (the live "MiniMe is
//     learning" affordance — owner sees their catalog populating as they type)
//
// On done, swap the composer for a recap card listing everything Selam
// "learned" today — shop name, product count, delivery info, voice tag,
// uploaded assets — then a primary CTA into Try-It.
//
// State lives mostly on the server (notification_prefs.onboarding_chat) so
// the wizard is resumable across the BotFather app-switch / a refresh.
function StepCustomerChat({ initData, shopName, onDone, onBack, onTrack, uploadedAssets, setUploadedAssets }) {
  // Chat entries:
  //   { who: 'selam', text }                            ← Selam's bubble (left, white)
  //   { who: 'you', text, items?: string[] }            ← owner's bubble (right, mint),
  //                                                       with optional inline captured
  //                                                       mint chips below ("Leather
  //                                                       tote – 3200 birr").
  const [chat, setChat]   = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  const [turn, setTurn]   = useState(0);
  const [maxTurns, setMaxTurns] = useState(4);
  const [captured, setCaptured] = useState({});
  const [productsTotal, setProductsTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [uploading, setUploading] = useState(false);
  const startedRef = useRef(false);
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  // Monotonic id per owner bubble so an async draft can attach to the right one.
  const msgIdRef = useRef(0);
  // Cap the "MiniMe could reply" drafts — 1–2 lands the aha without noise/cost.
  const draftsShownRef = useRef(0);

  // Generate MiniMe's draft answer to the question the owner JUST taught, and
  // attach it under their bubble — the "it learned AND it works" moment, live
  // inside the teaching chat. Reuses /api/onboarding/preview (the Try-It engine);
  // fired non-blocking so it NEVER delays Selam's next message on slow networks.
  async function fetchMiniMeDraft(question, bubbleId) {
    const patch = (fields) => setChat(c => c.map(m => (m.id === bubbleId ? { ...m, ...fields } : m)));
    patch({ draftLoading: true });
    try {
      const r = await fetch('/api/onboarding/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ message: question }),
      });
      const j = await r.json();
      if (r.ok && j.reply) patch({ draft: j.reply, draftLoading: false });
      else patch({ draftLoading: false }); // no catalog yet / no_draft → silently skip
    } catch {
      patch({ draftLoading: false });
    }
  }

  // Turn-0 starter chips — tap to drop an editable opening into the composer so
  // the owner never faces a blank box at Selam's first message. Structural stems
  // (not fabricated catalog) so the owner completes them in their own words.
  const STARTERS = ['We sell ', 'Mainly ', 'We make '];
  function tapStarter(stem) {
    setInput(stem);
    onTrack?.('customer_chat_seed_tapped');
    inputRef.current?.focus();
  }

  // Paperclip → file picker. Routes through the shared uploadProduct helper,
  // which posts to /api/teach/image (images) or /api/documents/upload (PDFs).
  // We push the result into the wizard-level `uploadedAssets` so the chip
  // persists across Customer Chat → Recap → Try-It (the owner can deliberately
  // test against the upload in Try-It — that's the "it actually worked" moment).
  async function onPickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploading) return;
    const isImg = isImage(file);
    const label = isImg ? 'photo' : 'file';
    setErr('');
    setUploading(true);
    // Show the upload as the owner's own message (in-character — they're the
    // one "sending" the file to Selam in this fiction).
    setChat(c => [...c, { who: 'you', text: `[Sent ${label}: ${file.name}]` }]);
    try {
      const res = await uploadProduct(file, { initData });
      onTrack?.('conversation_upload');
      const n = res.products_added || 0;
      // Attach captured chips inline under the upload "message".
      const items = [];
      if (n > 0) items.push(`${n} product${n === 1 ? '' : 's'} added`);
      else items.push(`Saved as reference`);
      setChat(c => {
        const next = [...c];
        const last = next[next.length - 1];
        if (last && last.who === 'you') next[next.length - 1] = { ...last, items };
        return next;
      });
      if (n > 0) setProductsTotal(t => t + n);
      // Persistent chip for the captured-state strip + recap.
      const asset = {
        kind: isImg ? 'image' : 'document',
        label: isImg ? `Photo: ${file.name}` : `PDF: ${file.name}`,
        products_added: n,
        document_id: res.document_id || null,
      };
      setUploadedAssets?.(prev => [...(prev || []), asset]);
    } catch (ex) {
      setErr(ex.message || 'Upload failed. Try again.');
      // Drop the "[Sent …]" bubble on failure so it doesn't sit there.
      setChat(c => c.slice(0, -1));
    } finally {
      setUploading(false);
    }
  }

  // Drop the owner INTO an active chat — Selam's opener is fetched on mount
  // (no "tap to start" friction). Server is stateful, so re-entry on refresh
  // / app-switch resumes the same pending Selam message rather than re-asking.
  useEffect(() => {
    if (startedRef.current || !initData) return;
    startedRef.current = true;
    onTrack?.('customer_chat_started');
    (async () => {
      try {
        const r = await fetch('/api/onboarding/interview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({}),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `start_failed`);
        setChat([{ who: 'selam', text: j.reply || j.question }]);
        setTurn(j.turn || 0);
        setMaxTurns(j.max_turns || 4);
        setCaptured(j.captured || {});
        setProductsTotal(j.total_products || 0);
      } catch (e) {
        console.error('Onboarding chat failed to start:', e);
        setErr('Selam is taking a break. You can still finish your setup!');
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
    // The Selam question this reply answers — used to show MiniMe drafting the
    // same answer for a real customer once it's learned it.
    const answeredQuestion = (() => {
      for (let i = chat.length - 1; i >= 0; i--) if (chat[i].who === 'selam') return chat[i].text;
      return '';
    })();
    // Push the owner's bubble optimistically. captured_items from the server
    // attach to THIS bubble below the text, so it feels like MiniMe is
    // learning attached to their reply (not floating in the centre).
    const myId = ++msgIdRef.current;
    setChat(c => [...c, { who: 'you', text, id: myId }]);
    onTrack?.('customer_chat_reply');
    try {
      const r = await fetch('/api/onboarding/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ message: text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'send_failed');
      setProductsTotal(j.total_products || productsTotal);
      setCaptured(j.captured || captured);
      setTurn(j.turn || turn);
      const capturedItems = Array.isArray(j.captured_items) ? j.captured_items : [];
      setChat(c => c.map(m => (m.id === myId ? { ...m, items: capturedItems } : m)));
      const nextMsg = j.reply || j.question;
      if (j.done) {
        setChat(c => [...c, { who: 'selam', text: nextMsg }]);
        setDone(true);
        onTrack?.('customer_chat_finished');
      } else {
        setChat(c => [...c, { who: 'selam', text: nextMsg }]);
      }
      // Trigger the MiniMe "it learned" draft preview
      if (draftsShownRef.current < 2) {
        draftsShownRef.current += 1;
        onTrack?.('customer_chat_minime_draft');
        fetchMiniMeDraft(answeredQuestion, myId);
      }
    } catch (e) {
      console.error('Interview reply failed:', e);
      setErr(e.message || 'Could not send. Try again.');
      setInput(text);
      setChat(c => c.slice(0, -1));
    } finally {
      setBusy(false);
    }

  // Captured-state chip strip at the top of the chat. Persists upload chips
  // across the flow (handed in from `OnboardingInner`).
  const chips = [
    shopName ? { label: shopName, on: true } : null,
    captured.catalog || productsTotal > 0 ? { label: `Catalog · ${productsTotal}`, on: true } : null,
    captured.delivery ? { label: 'Delivery', on: true } : null,
    captured.voice    ? { label: 'Voice', on: true } : null,
    captured.faq      ? { label: 'FAQ', on: true } : null,
    ...(uploadedAssets || []).map(a => ({ label: a.label, on: true, soft: true })),
  ].filter(Boolean);

  return (
    <div style={{ position: 'fixed', inset: 0, background: PAPER, display: 'flex', flexDirection: 'column', fontFamily: BODY, color: INK }}>
      {/* Top bar — Telegram-style chat header. Owner is in a chat WITH a person, not in a wizard. */}
      <div style={{ padding: 'max(14px, env(safe-area-inset-top)) 18px 12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${LINE}`, background: '#fff' }}>
        <button onClick={onBack} style={{ border: 0, background: 'transparent', padding: 6, cursor: 'pointer', lineHeight: 1, marginLeft: -6 }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6"/>
          </svg>
        </button>
        {/* Selam avatar — mint circle with white "S". */}
        <div style={{
          width: 38, height: 38, borderRadius: '50%', background: MINT, color: '#fff',
          display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 16, letterSpacing: '0.02em',
          flexShrink: 0,
        }}>S</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: INK, lineHeight: 1.15 }}>Selam</div>
          <div style={{ fontSize: 11, color: MUTED, display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#3FBA73' }} />
            online
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: MUTED, letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0 }}>
          {done ? 'Done' : `${Math.min(turn + 1, maxTurns)} / ${maxTurns}`}
        </div>
      </div>

      {/* Captured-state chip strip. Soft mint = uploaded asset (persists into Try-It). */}
      {chips.length > 0 && (
        <div style={{ padding: '8px 18px 4px', display: 'flex', flexWrap: 'wrap', gap: 6, background: '#fff', borderBottom: `1px solid ${LINE}` }}>
          {chips.map((c, idx) => (
            <span key={`${c.label}-${idx}`} style={{
              fontSize: 11, color: MINT,
              background: c.soft ? 'rgba(79,163,138,0.06)' : 'rgba(79,163,138,0.1)',
              border: c.soft ? `1px dashed rgba(79,163,138,0.3)` : 'none',
              padding: '3px 10px', borderRadius: 999, fontWeight: 500,
            }}>{c.label}</span>
          ))}
        </div>
      )}

      {/* Chat body */}
      <div ref={listRef} style={{
        flex: 1, padding: '18px 18px 24px', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0,
      }}>
        {chat.length === 0 && !err && (
          <div style={{ color: MUTED, fontSize: 13, textAlign: 'center', marginTop: 32 }}>
            Selam is typing…
          </div>
        )}
        {/* Turn-0 framing — the single biggest bail point was owners freezing at
            Selam's opener because nothing told them what this is. Shown until the
            owner sends their first reply (turn advances past 0). */}
        {turn === 0 && !done && chat.length > 0 && (
          <div className="fade-up" style={{
            alignSelf: 'center', maxWidth: '90%', textAlign: 'center',
            color: MUTED, fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 6px',
          }}>
            Selam's a pretend customer 👋 Reply like you would to a real shopper.
          </div>
        )}
        {chat.map((m, i) => {
          const isSelam = m.who === 'selam';
          // Show Selam's mini-avatar only on the first bubble of a streak (cleaner look).
          const prev = i > 0 ? chat[i - 1] : null;
          const firstInStreak = !prev || prev.who !== m.who;
          return (
            <div key={i} className="fade-up" style={{
              alignSelf: isSelam ? 'flex-start' : 'flex-end',
              maxWidth: '86%',
              display: 'flex', alignItems: 'flex-end', gap: 6,
              flexDirection: isSelam ? 'row' : 'column',
            }}>
              {isSelam && (
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: firstInStreak ? MINT : 'transparent',
                  color: '#fff', display: 'grid', placeItems: 'center',
                  fontSize: 10, fontWeight: 600, flexShrink: 0,
                  visibility: firstInStreak ? 'visible' : 'hidden',
                }}>S</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: isSelam ? 'flex-start' : 'flex-end', maxWidth: '100%' }}>
                <div style={{
                  background: isSelam ? '#fff' : MINT,
                  border: isSelam ? `1px solid ${LINE}` : 'none',
                  color: isSelam ? INK : '#fff',
                  borderRadius: isSelam ? '4px 16px 16px 16px' : '16px 16px 4px 16px',
                  padding: '10px 14px', fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-wrap',
                }}>
                  {m.text}
                </div>
                {/* Inline mint chips under the owner's bubble — the live
                    "MiniMe is learning" affordance, attached to THEIR reply. */}
                {!isSelam && Array.isArray(m.items) && m.items.length > 0 && (
                  <div className="fade-up" style={{
                    marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end',
                  }}>
                    {m.items.map((it, j) => (
                      <span key={j} style={{
                        fontSize: 10.5, color: MINT,
                        background: 'rgba(79,163,138,0.1)',
                        border: `1px solid rgba(79,163,138,0.25)`,
                        padding: '2px 8px', borderRadius: 999, fontWeight: 500,
                      }}>{it}</span>
                    ))}
                  </div>
                )}
                {/* "MiniMe could reply for you" — the live proof that it learned
                    AND works, drafting the answer the owner just taught. */}
                {!isSelam && (m.draftLoading || m.draft) && (
                  <div className="fade-up" style={{
                    marginTop: 7, maxWidth: '100%', alignSelf: 'flex-end',
                    background: '#fff', border: `1px solid ${MINT}`,
                    borderRadius: '14px 14px 4px 14px', padding: '9px 12px',
                    boxShadow: '0 4px 14px -10px rgba(79,163,138,0.5)',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 5, marginBottom: m.draft ? 4 : 0,
                      fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: MINT,
                    }}>
                      <MiniMeLogo size={12} color={MINT} accent={MINT} />
                      MiniMe could reply
                    </div>
                    {m.draftLoading && !m.draft ? (
                      <div style={{ fontSize: 12.5, color: MUTED, fontStyle: 'italic' }}>drafting in your voice…</div>
                    ) : (
                      <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{m.draft}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="fade-up" style={{ alignSelf: 'flex-start', color: MUTED, fontSize: 12, marginLeft: 30 }}>
            Selam is typing…
          </div>
        )}
        {err && (
          <div style={{ alignSelf: 'center', background: 'rgba(184,84,80,0.08)', border: '1px solid rgba(184,84,80,0.25)', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, color: ERROR }}>
            {err}
          </div>
        )}
      </div>

      {/* Footer: input (or recap card when done) */}
      <div style={{ padding: '12px 18px', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', borderTop: `1px solid ${LINE}`, background: PAPER }}>
        {done ? (
          <RecapCard
            shopName={shopName}
            productsTotal={productsTotal}
            captured={captured}
            uploadedAssets={uploadedAssets}
            onContinue={onDone}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Turn-0 seeded replies — kill the blank-box freeze. Tapping inserts
              an editable stem into the composer (does NOT auto-send). */}
          {turn === 0 && !input && !done && !busy && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {STARTERS.map(s => (
                <button
                  key={s}
                  onClick={() => tapStarter(s)}
                  style={{
                    appearance: 'none', cursor: 'pointer',
                    fontSize: 12.5, color: MINT,
                    background: 'rgba(79,163,138,0.1)',
                    border: `1px solid rgba(79,163,138,0.25)`,
                    padding: '6px 12px', borderRadius: 999, fontWeight: 500, fontFamily: BODY,
                  }}>{s.trim()}…</button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            {/* Hidden file input — wired to the paperclip below. */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={onPickFile}
              style={{ display: 'none' }}
            />
            {/* Paperclip — opens picker; routes through uploadProduct(). */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Send a product photo or price list"
              style={{
                appearance: 'none', border: `1px solid ${LINE}`, background: '#fff',
                borderRadius: 999, width: 42, height: 42, flexShrink: 0,
                cursor: uploading ? 'default' : 'pointer',
                display: 'grid', placeItems: 'center',
                opacity: uploading ? 0.5 : 1,
              }}>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <textarea
              ref={inputRef}
              placeholder="Reply like you would to a customer…"
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
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Closing recap card — the loss-aversion moment ─────────────────────────
// After Selam wraps the chat, we swap the composer for this card. Lists
// everything she "learned" today — shop name, catalog count, delivery, voice,
// uploaded assets — then a single primary CTA into Try-It. No skip option:
// they just did the work, they want to see the payoff. The card is what makes
// the moment land — owner stares at concrete proof their AI now knows them
// before they hit the test step.
function RecapCard({ shopName, productsTotal, captured, uploadedAssets, onContinue }) {
  const bullets = [];
  if (productsTotal > 0) bullets.push({ k: 'Catalog', v: `${productsTotal} product${productsTotal === 1 ? '' : 's'}` });
  if (captured?.delivery) bullets.push({ k: 'Delivery', v: 'how you deliver and where' });
  if (captured?.faq) bullets.push({ k: 'FAQ', v: 'payment and hours' });
  if (captured?.voice) bullets.push({ k: 'Voice', v: 'your warm, casual tone' });
  if (uploadedAssets && uploadedAssets.length > 0) {
    bullets.push({ k: 'You uploaded', v: uploadedAssets.map(a => a.label.replace(/^(Photo|PDF): /, '')).join(', ') });
  }
  const learnedCount = bullets.length;

  return (
    <div className="fade-up" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '16px 16px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
        Selam learned
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 19, marginTop: 5, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
        {learnedCount} thing{learnedCount === 1 ? '' : 's'} about <span style={{ fontStyle: 'italic' }}>{shopName || 'your shop'}</span>.
      </div>
      {bullets.length > 0 && (
        <ul style={{ margin: '12px 0 14px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: INK, lineHeight: 1.35 }}>
              <span style={{ color: MINT, marginTop: 1, flexShrink: 0 }}>·</span>
              <span><span style={{ color: MUTED }}>{b.k}: </span>{b.v}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={onContinue}
        style={{
          width: '100%', appearance: 'none', border: 0, background: INK, color: PAPER,
          padding: '14px', borderRadius: 999, fontSize: 14.5, fontWeight: 500, fontFamily: BODY,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
        Go live
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={PAPER} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 5l7 7-7 7"/>
        </svg>
      </button>
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

// ─── Trial disclosure (Mode Chooser) ─────────────────────────────────────────
// Shown right before the owner activates (the consent moment). Tells them the
// 5-day clock starts when they tap "Use MiniMe directly" or "Connect your own
// bot", what they get during the trial, and what happens after. Compliance
// requires this be visible BEFORE activation — they must know what they're
// signing up for. Fires `trial_disclosed` for the audit trail.
function TrialDisclosure({ onTrack }) {
  useEffect(() => { onTrack?.('trial_disclosed'); }, [onTrack]);

  return (
    <div className="fade-up delay-1" style={{ marginTop: 16 }}>
      <div style={{
        background: 'rgba(176,138,74,0.06)', border: `1px solid rgba(176,138,74,0.22)`,
        borderRadius: 12, padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: GOLD,
          }}>
            5-day free trial
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: '#4A5E5A', lineHeight: 1.5 }}>
          Full access starts the moment you go live. After 5 days, MiniMe is{' '}
          <strong>2,500 ETB / month</strong> (or 25,000 ETB / year — 2 months free).
          You'll get a reminder before the trial ends — no surprise charges.
        </div>
      </div>
    </div>
  );
}

// ─── Trial countdown badge (Share screens) ───────────────────────────────────
// Visible chip on both post-activation success screens. Pulls trial_ends_at
// from the live business so the countdown updates if they re-enter the wizard.
// Refreshes nothing on its own — just renders what the server set on activation.
function TrialBadge({ trialEndsAt }) {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt) - Date.now();
  const days = Math.max(0, Math.ceil(ms / 86400000));
  if (days <= 0) return null;

  return (
    <div className="fade-up" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'rgba(176,138,74,0.1)', border: `1px solid rgba(176,138,74,0.25)`,
      borderRadius: 999, padding: '5px 12px',
      fontSize: 11.5, fontWeight: 600, color: GOLD, letterSpacing: '0.04em',
      marginTop: 12,
    }}>
      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12,6 12,12 16,14"/>
      </svg>
      {days} day{days === 1 ? '' : 's'} of free trial left
    </div>
  );
}

// ─── Personal-mode awareness card ────────────────────────────────────────────
// Shown on BOTH post-activation success screens (shared mode + custom bot).
// Informational only — no CTA, no instructions. Tells the owner that MiniMe
// can also handle their personal Telegram chats (secretary mode) without
// pushing them to set it up right now. They can find it in Settings → Modes
// when they're ready. Fires a one-shot telemetry event on mount so we can
// measure the awareness → activation conversion.
function PersonalModeCard({ onTrack }) {
  useEffect(() => {
    onTrack?.('personal_mode_card_shown');
  }, [onTrack]);

  // Owners keep saying secretary mode is the part they actually want — replies
  // landing on THEIR personal line, not a separate bot. The old card was a
  // passive "turn it on later" tip and most owners never came back. Now it's
  // an active CTA into the walkthrough on Settings → Modes, with the headline
  // promise spelled out so it doesn't look like an afterthought.
  return (
    <div className="fade-up delay-5" style={{ marginTop: 18 }}>
      <a
        href="/settings/modes"
        onClick={() => onTrack?.('personal_mode_card_tapped')}
        style={{
          display: 'block', textDecoration: 'none',
          background: '#fff', border: `1.5px solid ${MINT}`,
          borderRadius: 14, padding: '16px 18px',
          boxShadow: '0 6px 18px -10px rgba(79,163,138,0.35)',
          position: 'relative',
        }}
      >
        <div style={{
          position: 'absolute', top: -10, right: 16,
          background: MINT, color: '#fff', fontSize: 10, fontWeight: 600,
          padding: '3px 10px', borderRadius: 999, letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          Most owners enable this next
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span style={{
            width: 40, height: 40, borderRadius: 11, flexShrink: 0,
            background: 'rgba(79,163,138,0.12)', display: 'grid', placeItems: 'center',
            fontSize: 22,
          }}>🕴️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>
              Also reply on your <em>personal</em> Telegram
            </div>
            <div style={{ fontSize: 13, color: '#4A5E5A', marginTop: 4, lineHeight: 1.5 }}>
              People text <strong>your</strong> name — MiniMe handles customers, knows family from friends, and never pitches the business to people you love.
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 13, fontWeight: 600, color: MINT }}>
              Set it up in 1 minute →
            </div>
          </div>
        </div>
      </a>
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
  // Trial countdown — set from the activation response (complete-shared /
  // bot/link both return trial_ends_at on the business). Renders as a chip
  // on both success screens so the owner sees their countdown immediately.
  const [trialEndsAt, setTrialEndsAt] = useState(null);

  // Track the activation event — the single most important conversion in the
  // whole product. We used to auto-navigate to the dashboard after 4s as a
  // "failsafe", but that yanked the owner off the Share screen before they
  // could copy their storefront link, share to Telegram/WhatsApp, or enter
  // their phone number. The Share screen has its own explicit "Continue"
  // CTA that fires onNext() when the owner is ready — no auto-timer needed.
  useEffect(() => {
    if (status !== 'done' && status !== 'shared_done') return;
    onTrack?.(status === 'done' ? 'connected_custom' : 'connected_shared');
    // Compliance audit: record that the trial actually started for this owner.
    // Pairs with `trial_disclosed` (consent moment) and the trial_ends_at column
    // on businesses so we can prove the owner knew about + opted into the trial.
    if (trialEndsAt) onTrack?.('trial_started');
  }, [status, onTrack, trialEndsAt]);
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

      // Capture trial end-date so the success screen can render the countdown chip.
      if (j.trial_ends_at) setTrialEndsAt(j.trial_ends_at);

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
        // Fallback: if bot/link didn't return trial_ends_at (older deployment),
        // pick it up from the refreshed business in context.
        if (!j.trial_ends_at && authJ?.business?.trial_ends_at) setTrialEndsAt(authJ.business.trial_ends_at);
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
      if (j.business?.trial_ends_at) setTrialEndsAt(j.business.trial_ends_at);

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
            <TrialBadge trialEndsAt={trialEndsAt} />
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

          {/* Personal-mode awareness — "MiniMe can also reply on your personal Telegram" */}
          <PersonalModeCard onTrack={onTrack} />
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
    // Real share copy that names the business — generic "Check out my shop!"
    // gave customers zero context and was likely a reason the live-but-empty
    // shops stayed empty. Now: business name + one-line value prop.
    const bizName = business?.name || 'my shop';
    const shareText = `You can now order from ${bizName} on Telegram — ask anything, get an instant answer 👇`;
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
            <TrialBadge trialEndsAt={trialEndsAt} />
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

          {/* Personal-mode awareness — "MiniMe can also reply on your personal Telegram" */}
          <PersonalModeCard onTrack={onTrack} />
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

  // ─── Go Live: one-tap shared activation, custom bot demoted to a link ────
  // The old two-card chooser was the single worst drop-off point in the funnel
  // (owners stalled deciding between "MiniMe directly" vs "own bot"). Now the
  // ONLY decision is the big Go Live button; the custom @YourShopBot path
  // still exists, but as a quiet link — and it's also offered again
  // post-activation in Settings → Bot, so nothing is lost by skipping it here.
  if (!mode) {
    return (
      <Shell step={2} total={3} onBack={onBack} onNext={activateSharedMode} ctaLabel="🚀 Go Live now"
             disabled={false} busy={busy}>
        <div className="fade-up">
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
            Last step
          </div>
          <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
            Go <span style={{ fontStyle: 'italic' }}>live</span>.
          </div>
          <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.45 }}>
            One tap and your shop is open — customers message a link, MiniMe answers in your voice.
          </p>
        </div>

        {/* Trial disclosure — consent moment, BEFORE the activation button */}
        <TrialDisclosure onTrack={onTrack} />

        {/* What happens when you tap Go Live — reassurance, not a decision */}
        <div className="fade-up delay-1" style={{
          marginTop: 24, background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 16, padding: '16px 18px',
        }}>
          {[
            ['spark', 'Your shop link is created instantly — share it anywhere'],
            ['reply', 'MiniMe answers customers 24/7 using what you just taught it'],
            ['shield', 'You see every conversation and can step in anytime'],
          ].map(([icon, label], i) => (
            <div key={icon} style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0, borderTop: i ? `1px solid ${LINE}` : 'none' }}>
              <span style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: 'rgba(79,163,138,0.1)', display: 'grid', placeItems: 'center',
              }}>
                <LineIcon name={icon} color={MINT} size={17} />
              </span>
              <div style={{ fontSize: 13.5, color: '#344843', lineHeight: 1.4, fontFamily: BODY }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Custom bot — kept, but as a quiet secondary path */}
        <div className="fade-up delay-2" style={{ marginTop: 18, textAlign: 'center' }}>
          <button
            onClick={() => { onTrack?.('connect_custom'); setMode('custom'); }}
            style={{
              appearance: 'none', background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 13, color: MUTED, fontFamily: BODY, textDecoration: 'underline',
              textUnderlineOffset: 3, padding: 8,
            }}
          >
            Prefer your own @YourShopBot? Connect it instead →
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
function Welcome({ onNext, busy }) {
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
            fontSize: 15, color: 'rgba(244,238,225,0.75)', marginTop: 14,
            lineHeight: 1.55,
          }}>
            An AI assistant that answers your customers on Telegram — in your voice, day and night.
          </p>

          {/* Three short promises — half the bullet count of the old screen.
              Drop-off at welcome was 33% of signups; the old "what you get"
              list looked like a survey and people bounced. Now it reads in 5
              seconds and the CTA is the next action. */}
          <div className="fade-up delay-4" style={{ marginTop: 28 }}>
            {[
              { icon: 'reply',  text: 'Answers customers for you, 24/7' },
              { icon: 'learn',  text: 'Learns your voice and your prices' },
              { icon: 'shield', text: 'You stay in control of every reply' },
            ].map((f, i) => (
              <div key={i} style={{
                display: 'flex', gap: 14, alignItems: 'center',
                padding: '14px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(244,238,225,0.1)',
              }}>
                <LineIcon name={f.icon} color={GOLDSF} size={20} strokeWidth={1.3} />
                <span style={{ fontSize: 14.5, color: 'rgba(244,238,225,0.85)', lineHeight: 1.4 }}>{f.text}</span>
              </div>
            ))}
          </div>
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
            disabled={busy}
            style={{
              width: '100%', appearance: 'none', border: 0,
              background: PAPER, color: INK,
              padding: '16px', borderRadius: 999,
              fontSize: 15, fontWeight: 500, cursor: busy ? 'default' : 'pointer',
              fontFamily: BODY, letterSpacing: '-0.01em',
              opacity: busy ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              touchAction: 'manipulation',
            }}
          >
            {busy ? 'Setting up…' : "Let's go"}
            {!busy && (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7"/>
              </svg>
            )}
          </button>
          {/* Consent — the "Let's go" tap IS the agreement (account is created on
              this tap). One line, no checkbox, to keep front-door friction near zero. */}
          <p style={{
            margin: '12px 2px 0', fontSize: 11.5, lineHeight: 1.5,
            color: 'rgba(244,238,225,0.55)', textAlign: 'center',
          }}>
            By continuing you agree to our{' '}
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" style={{ color: GOLDSF, textDecoration: 'underline' }}>Terms</a>
            {' '}&amp;{' '}
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" style={{ color: GOLDSF, textDecoration: 'underline' }}>Privacy</a>,
            and that replies are AI-generated.
          </p>
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
  // Signup gate busy state — the Welcome CTA creates the account + records consent.
  const [signingUp, setSigningUp] = useState(false);
  // Shop name captured in the pre-step. Used by Selam's opener and the recap.
  const [shopName, setShopName] = useState('');
  // Wizard-level upload tracking so chips persist Customer Chat → Recap → Try-It.
  // Each entry: { kind: 'image'|'document', label, products_added?, document_id? }
  const [uploadedAssets, setUploadedAssets] = useState([]);

  // ── Resume across the BotFather app-switch ──────────────────────────────────
  // Creating a bot means LEAVING MiniMe (to @BotFather) and coming back — which
  // reloads this Mini App and wipes pure client state. That round-trip was the
  // single biggest reason owners never finished linking their own bot: they
  // returned to a fresh wizard, couldn't find the paste field, and bailed to
  // shared mode. We snapshot {screen, answers} to localStorage so a return lands
  // them right back on the connect step with everything intact.
  // Flow: welcome → shop_name → customer_chat (Selam, ≤4 turns) → connect.
  // The chat seeds the catalog + voice that make the bot non-empty at go-live.
  // Legacy 'conversation' resumes are dropped so they fall back to 'welcome'
  // (signup is idempotent).
  const VALID_RESUME = ['welcome', 'shop_name', 'customer_chat', 'connect'];
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

  // ── Signup gate ─────────────────────────────────────────────────────────────
  // The Welcome "Let's go" tap is the explicit account-create + consent moment:
  // POST /api/onboarding/signup creates the business (if new) and records consent,
  // then we advance into the wizard. On failure we still advance — the interview
  // lazy-create is the safety net — so a flaky network never blocks onboarding.
  // Skipped entirely in preview (replay) mode: no mutation.
  const goSignup = useCallback(async () => {
    if (signingUp) return;
    if (preview || !initData) { setScreen('shop_name'); return; }
    setSigningUp(true);
    try {
      const r = await fetch('/api/onboarding/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (r.ok && j.business) setBusiness?.(j.business);
    } catch (e) {
      console.warn('[onboarding] signup failed, continuing:', e?.message);
    }
    track('signup');
    setSigningUp(false);
    setScreen('shop_name');
  }, [signingUp, preview, initData, setBusiness, track]);

  // Auto-redirect only on FIRST mount if the owner is already onboarded
  // (e.g. they navigated back to /onboarding by accident). We must NOT re-fire
  // this when `business.onboarding_completed` flips true DURING the wizard —
  // that happens inside StepConnect after activation, and the share screen
  // immediately after activation is part of the wizard, not somewhere to be
  // bounced away from. `arrivedOnboardedRef` captures the state at first load
  // and the redirect runs at most once.
  const arrivedOnboardedRef = useRef(null); // null = not checked yet, true/false = locked
  useEffect(() => {
    if (loading) return;
    if (preview) return;
    if (arrivedOnboardedRef.current === null) {
      arrivedOnboardedRef.current = isOnboarded(business);
      if (arrivedOnboardedRef.current) {
        clearResume();
        router.replace('/');
      }
    }
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
    const prev = {
      shop_name: 'welcome',
      customer_chat: 'shop_name',
      connect: 'customer_chat',
    };
    const target = prev[screen];
    const handler = () => { if (target) setScreen(target); };
    try {
      if (target) { bb.show(); bb.onClick(handler); }
      else { bb.hide(); }
    } catch {}
    return () => { try { bb.offClick(handler); } catch {} };
  }, [screen]);

  // saveBusiness is no longer needed — POST /api/onboarding/signup creates the
  // business (+ consent) when the owner taps "Let's go" on Welcome, so the row
  // already exists by the time they name the shop, chat with Selam, and connect.

  if (screen === 'loader') return <Loader authReady={authReady} onDone={() => setScreen(resumeRef.current || 'welcome')} />;
  if (screen === 'welcome') return <Welcome onNext={goSignup} busy={signingUp} />;
  if (screen === 'shop_name') return (
    <StepShopName
      initData={initData}
      onTrack={track}
      onBack={() => setScreen('welcome')}
      onDone={(name) => { setShopName(name); setScreen('customer_chat'); }}
    />
  );
  if (screen === 'customer_chat') return (
    <StepCustomerChat
      initData={initData}
      shopName={shopName}
      onDone={() => setScreen('connect')}
      onBack={() => setScreen('shop_name')}
      onTrack={track}
      uploadedAssets={uploadedAssets}
      setUploadedAssets={setUploadedAssets}
    />
  );
  if (screen === 'connect') return (
    <StepConnect
      initData={initData}
      setBusiness={setBusiness}
      preview={preview}
      onTrack={track}
      onBack={() => setScreen('customer_chat')}
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