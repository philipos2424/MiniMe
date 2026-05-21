'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../context/TelegramContext';
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
const AMH    = "'Noto Sans Ethiopic', 'Geist', sans-serif";
const MONO   = "'Geist Mono', ui-monospace, monospace";

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
              background: i === step ? INK : LINE,
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

// ─── Step 0: Business ─────────────────────────────────────────────────────────
function StepBusiness({ value, setValue, onNext, onBack }) {
  const { name, category, description } = value;
  return (
    <Shell step={0} total={3} onBack={onBack} onNext={onNext} ctaLabel="Continue" disabled={!name.trim() || !category}>
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>Step one</div>
        <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
          Tell me about your shop.
        </div>
        <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.45 }}>
          So I know how to speak — and what to learn.
        </p>
      </div>

      <div className="fade-up delay-1" style={{ marginTop: 28 }}>
        <label style={{ fontSize: 12, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>
          Business name
        </label>
        <input
          placeholder="e.g. Selam Boutique"
          value={name}
          onChange={e => setValue({ ...value, name: e.target.value })}
          autoFocus
          style={{ marginTop: 8 }}
        />
      </div>

      <div className="fade-up delay-2" style={{ marginTop: 22 }}>
        <label style={{ fontSize: 12, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>
          What do you sell?
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setValue({ ...value, category: c.id })}
              style={{
                padding: '16px 14px', minHeight: 48, borderRadius: 12, cursor: 'pointer',
                border: `1.5px solid ${category === c.id ? INK : LINE}`,
                background: category === c.id ? INK : '#fff',
                color: category === c.id ? PAPER : INK,
                fontFamily: BODY, fontSize: 14.5, textAlign: 'left', fontWeight: 500,
                transition: 'all .15s ease',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fade-up delay-3" style={{ marginTop: 22 }}>
        <label style={{ fontSize: 12, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>
          What does your business do?
        </label>
        <textarea
          placeholder="e.g. We sell handmade leather bags and accessories, crafted in Addis Ababa…"
          value={description}
          onChange={e => setValue({ ...value, description: e.target.value })}
          rows={2}
          style={{ marginTop: 8, resize: 'vertical', lineHeight: 1.5 }}
        />
        <div style={{ fontSize: 11, color: MUTED, marginTop: 6, lineHeight: 1.4 }}>
          Optional — helps MiniMe answer questions about your shop.
        </div>
      </div>
    </Shell>
  );
}

// ─── Step 1: Voice & Tone ────────────────────────────────────────────────────
function StepVoice({ value, setValue, onNext, onBack }) {
  const { tone = 'warm', lang = 'mixed' } = value;

  const TONES = [
    { id: 'warm',    label: 'Warm',    sample: "Selam! Yes, the navy one is in stock 🌿 Want me to hold one for you?" },
    { id: 'direct',  label: 'Direct',  sample: "Yes, navy in stock. 2,400 birr. Tilegram pay or CBE — which?" },
    { id: 'pro',     label: 'Professional', sample: "Hello — the navy option is available at 2,400 birr. Shall I reserve?" },
  ];
  const LANGS = [
    { id: 'amharic', label: 'አማርኛ',   sub: 'Amharic' },
    { id: 'mixed',   label: 'Mixed',   sub: 'Amh + Eng' },
    { id: 'english', label: 'English', sub: 'English only' },
  ];
  const currentSample = TONES.find(t => t.id === tone)?.sample || TONES[0].sample;

  return (
    <Shell step={1} total={3} onBack={onBack} onNext={onNext} ctaLabel="Continue">
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>Step two</div>
        <div style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, marginTop: 8, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
          Sound like <span style={{ fontStyle: 'italic' }}>you</span>.
        </div>
        <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 8, lineHeight: 1.45 }}>
          Pick a language and a tone. You can change either anytime.
        </p>
      </div>

      <div className="fade-up delay-1" style={{ marginTop: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>Language</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
          {LANGS.map(l => (
            <button key={l.id} onClick={() => setValue({ ...value, lang: l.id })} style={{
              padding: '12px 8px', borderRadius: 12, cursor: 'pointer',
              border: `1px solid ${lang === l.id ? INK : LINE}`,
              background: lang === l.id ? INK : '#fff',
              color: lang === l.id ? PAPER : INK,
              fontFamily: BODY, textAlign: 'center', transition: 'all .15s ease',
            }}>
              <div style={{ fontFamily: l.id === 'amharic' ? AMH : SERIF, fontSize: 17, lineHeight: 1 }}>{l.label}</div>
              <div style={{ fontSize: 10, opacity: 0.65, marginTop: 4, letterSpacing: '0.05em' }}>{l.sub}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="fade-up delay-2" style={{ marginTop: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>Tone</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {TONES.map(t => (
            <button key={t.id} onClick={() => setValue({ ...value, tone: t.id })} style={{
              flex: 1, padding: '10px 8px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${tone === t.id ? INK : LINE}`,
              background: tone === t.id ? INK : '#fff',
              color: tone === t.id ? PAPER : INK,
              fontFamily: BODY, fontSize: 13, fontWeight: 500,
              transition: 'all .15s ease',
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sample preview */}
      <div className="fade-up delay-3" style={{ marginTop: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>Sample reply</div>
        <div style={{
          marginTop: 8, background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14,
          padding: '14px 16px', position: 'relative',
        }}>
          <div style={{ position: 'absolute', top: -9, right: 14, background: CREAM, padding: '0 8px', fontSize: 11, fontFamily: SERIF, fontStyle: 'italic', color: GOLD }}>
            preview
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <MiniMeLogo size={22} />
            <div style={{ fontSize: 14.5, lineHeight: 1.45, color: INK, flex: 1 }}>{currentSample}</div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ─── Step 2: Connect bot ─────────────────────────────────────────────────────
function StepConnect({ onNext, onBack, onSkip, initData, setBusiness }) {
  const [token, setToken]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [status, setStatus] = useState(''); // '' | 'connecting' | 'done'
  const [err, setErr]       = useState('');

  // Failsafe: if we reach 'done' but setBusiness/context update fails silently,
  // auto-navigate to dashboard after 4s so user never gets permanently stuck.
  useEffect(() => {
    if (status !== 'done') return;
    const t = setTimeout(() => onNext(), 4000);
    return () => clearTimeout(t);
  }, [status, onNext]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = token.length > 20 && token.includes(':');

  async function connect() {
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
        body: JSON.stringify({ token: token.trim(), workspace_type: 'business' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to link bot. Check the token and try again.');

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

  if (status === 'connecting') {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: PAPER, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40, fontFamily: BODY,
      }}>
        <div className="loader-arc" />
        <div style={{ fontFamily: SERIF, fontSize: 22, marginTop: 22, color: INK }}>Mirroring your bot…</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>setting up webhook · loading voice profile</div>
      </div>
    );
  }

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

          {/* Next steps */}
          <div className="fade-up delay-1" style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>
              Do these 4 things now
            </div>
            {[
              {
                n: '1', icon: '📲',
                title: 'Send /start to your own bot',
                body: 'Open your bot in Telegram and send /start. This activates it and lets you test it yourself first before sharing with customers.',
              },
              {
                n: '2', icon: '📦',
                title: 'Add your products & prices',
                body: 'Go to Catalog in the menu and add what you sell with prices. MiniMe will quote exact prices to every customer — no more "DM for price."',
              },
              {
                n: '3', icon: '🧠',
                title: 'Teach it about your business',
                body: 'Tap Teach MiniMe and describe your business in your own words — services, delivery zones, payment methods, anything. The more you teach, the better it replies.',
              },
              {
                n: '4', icon: '📣',
                title: 'Share your bot link with customers',
                body: 'Your bot link is t.me/yourbotname. Put it in your Instagram bio, Facebook page, and WhatsApp status. Customers tap it and start chatting.',
              },
            ].map((s, i) => (
              <div key={i} className={`fade-up delay-${i + 2}`} style={{
                background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14,
                padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: 22, lineHeight: 1, marginTop: 1 }}>{s.icon}</span>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: INK, lineHeight: 1.2 }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: '#4A5E5A', marginTop: 5, lineHeight: 1.5 }}>{s.body}</div>
                </div>
              </div>
            ))}
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

  return (
    <Shell step={2} total={3} onBack={onBack} onNext={connect} ctaLabel="Connect bot"
           disabled={!valid} busy={busy} secondaryLabel="I'll do this later" onSecondary={onSkip}>
      <div className="fade-up">
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
          Step three · last one
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
        <label style={{ fontSize: 12, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>
          Paste your bot token
        </label>
        <input
          type="password"
          autoComplete="off"
          placeholder="1234567890:AAHd-…"
          value={token}
          onChange={e => setToken(e.target.value)}
          style={{ marginTop: 8, fontFamily: MONO, fontSize: 13, letterSpacing: '0.02em' }}
        />
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
            ❌ {err}
          </div>
        )}
        <p style={{ fontFamily: BODY, fontSize: 11, color: MUTED, marginTop: 8 }}>
          🔒 Encrypted at rest — never stored in plain text.
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
      display: 'flex', flexDirection: 'column', fontFamily: BODY, overflow: 'hidden',
    }}>
      <div className="grain" />

      <div style={{
        paddingTop: 'max(60px, calc(44px + env(safe-area-inset-top)))',
        padding: 'max(60px, calc(44px + env(safe-area-inset-top))) 28px 0',
        flex: 1, display: 'flex', flexDirection: 'column',
      }}>
        <div className="fade-up">
          <MiniMeLogo size={56} color={CREAM} accent={GOLDSF} />
        </div>

        <div style={{ marginTop: 'auto', marginBottom: 28 }}>
          <div className="fade-up delay-1" style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLDSF,
          }}>
            እንኳን ደህና መጡ · welcome
          </div>

          <div className="fade-up delay-2" style={{
            fontFamily: SERIF, fontWeight: 400, fontSize: 44, color: PAPER,
            marginTop: 14, lineHeight: 1, maxWidth: 320, letterSpacing: '-0.02em',
          }}>
            Your business,<br />
            <span style={{ fontStyle: 'italic', color: GOLDSF }}>handled.</span>
          </div>

          <p className="fade-up delay-3" style={{
            fontSize: 15, color: 'rgba(244,238,225,0.75)', marginTop: 18,
            maxWidth: 320, lineHeight: 1.55,
          }}>
            A second you for Telegram. Reads every message, drafts replies in your voice,
            and quietly learns the way you run things.
          </p>

          {/* What you get */}
          <div className="fade-up delay-4" style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { icon: '🤖', text: 'Your bot replies to customers automatically — in your voice and language' },
              { icon: '📦', text: 'Manages orders, payments, and product questions 24/7' },
              { icon: '🧠', text: 'Learns from every conversation and gets smarter over time' },
              { icon: '📲', text: 'You stay in control — approve, edit, or override any reply' },
            ].map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>{f.icon}</span>
                <span style={{ fontSize: 13.5, color: 'rgba(244,238,225,0.65)', lineHeight: 1.45 }}>{f.text}</span>
              </div>
            ))}
          </div>

        </div>

        <div className="fade-up delay-4" style={{ paddingBottom: 'max(28px, env(safe-area-inset-bottom))' }}>
          <button
            onClick={onNext}
            style={{
              width: '100%', appearance: 'none', border: 0,
              background: PAPER, color: INK,
              padding: '16px', borderRadius: 999,
              fontSize: 15, fontWeight: 500, cursor: 'pointer',
              fontFamily: BODY, letterSpacing: '-0.01em',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            Set up in 90 seconds
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7"/>
            </svg>
          </button>

          <a href="/demo" style={{
            display: 'block', textAlign: 'center', marginTop: 14,
            fontSize: 13, color: 'rgba(244,238,225,0.5)', textDecoration: 'none', fontWeight: 500,
          }}>
            See the full before & after story →
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter();
  const { initData, business, setBusiness, loading, error: authError } = useTelegram() || {};

  const [screen, setScreen] = useState('loader');
  const [onb, setOnb]       = useState({ name: '', category: '', description: '', tone: 'warm', lang: 'mixed' });
  const [saveErr, setSaveErr] = useState('');
  const [saving, setSaving]   = useState(false);

  // Auth is finished once loading is false (regardless of whether initData or error)
  const authReady = !loading;

  useEffect(() => {
    if (loading) return;
    if (business?.telegram_bot_username) { router.replace('/'); return; }
    if (business?.name) setOnb(o => ({ ...o, name: business.name }));
  }, [loading, business, router]);

  async function saveBusiness() {
    if (!onb.name.trim()) return;
    if (!initData) {
      // Auth hasn't completed — shouldn't be reachable but guard anyway
      setSaveErr('Authentication not ready. Please close and re-open the app.');
      return;
    }
    setSaving(true); setSaveErr('');
    try {
      const r = await fetch('/api/onboarding/business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ name: onb.name.trim(), workspace_type: 'business', category: onb.category, description: onb.description.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error || `Save failed (${r.status})`);
      }
      // Refresh context so subsequent steps see the persisted business
      if (j?.business && setBusiness) setBusiness(j.business);
    } catch (e) {
      setSaveErr(e.message);
      setSaving(false);
      throw e; // re-throw so the caller (onNext) doesn't advance
    }
    setSaving(false);
  }

  if (screen === 'loader') return <Loader authReady={authReady} onDone={() => setScreen('welcome')} />;
  if (screen === 'welcome') return <Welcome onNext={() => setScreen('business')} />;
  if (screen === 'business') return (
    <>
      <StepBusiness
        value={onb} setValue={setOnb}
        onBack={() => setScreen('welcome')}
        onNext={async () => {
          try { await saveBusiness(); setScreen('voice'); }
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
  if (screen === 'voice') return (
    <StepVoice
      value={onb} setValue={setOnb}
      onBack={() => setScreen('business')}
      onNext={() => setScreen('connect')}
    />
  );
  if (screen === 'connect') return (
    <StepConnect
      initData={initData}
      setBusiness={setBusiness}
      onBack={() => setScreen('voice')}
      onNext={() => router.replace('/')}
      onSkip={() => router.replace('/')}
    />
  );

  return null;
}
