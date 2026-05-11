'use client';
/**
 * Onboarding v3 — premium redesign.
 *
 * 4 screens:
 *   welcome → setup (name + category) → style (language + tone) → connect (bot token) → done
 *
 * Design: warm parchment (#FBF6EC), crimson (#8B2E1F), Fraunces serif — matches handoff.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../context/TelegramContext';

// ─── Design tokens (warm parchment palette from handoff) ────────────────────
const C = {
  bg:       '#FBF6EC',
  paper:    '#FFFFFF',
  ink:      '#1A0F08',
  ink2:     '#3D2817',
  muted:    '#6B5947',
  hint:     '#8A7560',
  line:     'rgba(26,15,8,0.10)',
  line2:    'rgba(26,15,8,0.18)',
  primary:  '#8B2E1F',
  accent:   '#D9A441',
  chip:     '#EFE5D0',
  green:    '#3F5D3F',
  greenBg:  '#EEF3EC',
};
const SERIF  = "'Fraunces', Georgia, serif";
const AMH    = "'Noto Serif Ethiopic', Georgia, serif";
const BODY   = "system-ui, -apple-system, sans-serif";

const CATEGORIES = [
  { id: 'electronics', emoji: '📱', label: 'Electronics & Tech' },
  { id: 'clothing',    emoji: '👗', label: 'Clothing & Fashion' },
  { id: 'food',        emoji: '🍽', label: 'Food & Restaurant'  },
  { id: 'beauty',      emoji: '💅', label: 'Beauty & Wellness'  },
  { id: 'onlineshop',  emoji: '🛒', label: 'Online Shop'        },
  { id: 'services',    emoji: '🔧', label: 'Services'           },
  { id: 'homegifts',   emoji: '🏠', label: 'Home & Gifts'       },
  { id: 'other',       emoji: '🏢', label: 'Other Business'     },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { initData, business, telegramUser, loading } = useTelegram() || {};

  const [step,     setStep]     = useState('welcome');  // welcome | setup | style | connect | done
  const [name,     setName]     = useState('');
  const [category, setCategory] = useState('');
  const [language, setLanguage] = useState('mixed');
  const [tone,     setTone]     = useState('warm');
  const [token,    setToken]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');
  const [linkedBot, setLinkedBot] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (business?.telegram_bot_username) router.replace('/');
    else if (business?.name) { setName(business.name); setStep('style'); }
  }, [loading, business, router]);

  if (loading) return <Shell bg={C.bg}><p style={{ color: C.hint, margin: 'auto', fontFamily: BODY }}>Loading…</p></Shell>;

  /* ── Welcome ──────────────────────────────────────────────────── */
  if (step === 'welcome') return (
    <Shell bg={C.bg}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px', textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 20, animation: 'mmBounce .9s cubic-bezier(.34,1.56,.64,1)' }}>🪞</div>
        <h1 style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 38, fontWeight: 400, margin: 0, color: C.ink, lineHeight: 1.1, letterSpacing: '-0.03em' }}>
          Your business,<br />
          <span style={{ color: C.primary }}>handled.</span>
        </h1>
        <p style={{ fontFamily: AMH, fontSize: 17, color: C.primary, margin: '10px 0 0' }}>
          ሥራዎን ለMiniMe ይስጡ።
        </p>
        <p style={{ fontFamily: BODY, fontSize: 15, color: C.muted, marginTop: 18, lineHeight: 1.65, maxWidth: 300, margin: '18px auto 0' }}>
          MiniMe reads every client message and replies in your exact voice — while you run your shop.
        </p>

        <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320, margin: '32px auto 0', width: '100%', textAlign: 'left' }}>
          {[
            ['⚡', 'Replies in seconds, not hours'],
            ['🎯', 'Learns your products & prices'],
            ['🤝', 'Sounds exactly like you'],
          ].map(([icon, text], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: C.paper, borderRadius: 8, border: `1px solid ${C.line}`, boxShadow: '0 1px 4px rgba(26,15,8,.06)' }}>
              <span style={{ fontSize: 20 }}>{icon}</span>
              <span style={{ fontFamily: BODY, fontSize: 14, color: C.ink, fontWeight: 500 }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      <Footer>
        <Btn onClick={() => setStep('setup')}>Get started — 2 min →</Btn>
        <a href="/demo" style={{ display: 'block', textAlign: 'center', marginTop: 14, fontFamily: BODY, fontSize: 13, color: C.hint, textDecoration: 'none' }}>
          ✨ Watch the story first →
        </a>
      </Footer>
      <Anim />
    </Shell>
  );

  /* ── Setup: Name + Category ───────────────────────────────────── */
  if (step === 'setup') return (
    <Shell bg={C.bg}>
      <TopBar onBack={() => setStep('welcome')} step={1} total={3} />
      <div style={{ flex: 1, padding: '24px 20px 20px', overflowY: 'auto' }}>
        <Label>What is your business?</Label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          placeholder="e.g. Selam Boutique, Hana Electronics…"
          style={inputStyle()}
          onFocus={e  => e.currentTarget.style.borderColor = C.primary}
          onBlur={e   => e.currentTarget.style.borderColor = C.line2}
        />

        <div style={{ height: 1, background: C.line, margin: '24px 0' }} />
        <Label sub="What type? MiniMe gives smarter answers for your industry.">What kind of business?</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
          {CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => setCategory(cat.id)} style={{
              appearance: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: BODY,
              border: `2px solid ${category === cat.id ? C.primary : C.line}`,
              background: category === cat.id ? 'rgba(139,46,31,0.06)' : C.paper,
              borderRadius: 10, padding: '12px 11px',
              boxShadow: '0 1px 3px rgba(26,15,8,.05)',
              transition: 'all 120ms ease',
            }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>{cat.emoji}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.25 }}>{cat.label}</div>
            </button>
          ))}
        </div>
      </div>
      <Footer>
        <Btn disabled={!name.trim() || busy} onClick={async () => {
          setBusy(true); setErr('');
          try {
            const r = await fetch('/api/onboarding/business', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
              body: JSON.stringify({ name: name.trim(), workspace_type: 'business', category }),
            });
            if (!r.ok) throw new Error((await r.json()).error || 'failed');
            setStep('style');
          } catch (e) { setErr(e.message); } finally { setBusy(false); }
        }}>Continue →</Btn>
        {err && <Err>{err}</Err>}
      </Footer>
    </Shell>
  );

  /* ── Style: Language + Tone ───────────────────────────────────── */
  if (step === 'style') return (
    <Shell bg={C.bg}>
      <TopBar onBack={() => setStep('setup')} step={2} total={3} />
      <div style={{ flex: 1, padding: '24px 20px 20px', overflowY: 'auto' }}>
        <Label>How do you talk to clients?</Label>

        {/* Language chips */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {[
            { v: 'amharic', label: 'አማርኛ', sub: 'Amharic only', flag: '🇪🇹' },
            { v: 'mixed',   label: 'Mixed',   sub: 'Amharic + English', flag: '🌍' },
            { v: 'english', label: 'English', sub: 'English only', flag: '🇬🇧' },
          ].map(o => (
            <button key={o.v} onClick={() => setLanguage(o.v)} style={{
              flex: 1, appearance: 'none', cursor: 'pointer', fontFamily: BODY,
              border: `2px solid ${language === o.v ? C.primary : C.line}`,
              background: language === o.v ? 'rgba(139,46,31,0.06)' : C.paper,
              borderRadius: 10, padding: '12px 6px', textAlign: 'center',
              transition: 'all 120ms ease',
            }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>{o.flag}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{o.label}</div>
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: C.line, margin: '24px 0' }} />
        <Label>What's your style?</Label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {[
            { v: 'warm',         emoji: '😊', title: 'Warm & friendly',  example: '"ሰላም! ደስ ይላኛል — አሁኑኑ ተነጋግረን!" 🙏' },
            { v: 'direct',       emoji: '⚡', title: 'Short & direct',   example: '"Ready Thursday. 4,500 ETB."' },
            { v: 'professional', emoji: '🤝', title: 'Professional',     example: '"Dear client, I\'m pleased to confirm…"' },
          ].map(o => (
            <button key={o.v} onClick={() => setTone(o.v)} style={{
              width: '100%', appearance: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: BODY,
              border: `2px solid ${tone === o.v ? C.primary : C.line}`,
              background: tone === o.v ? 'rgba(139,46,31,0.06)' : C.paper,
              borderRadius: 10, padding: '14px 16px',
              transition: 'all 120ms ease',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>{o.emoji}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{o.title}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 3, fontStyle: 'italic' }}>{o.example}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <Footer>
        <Btn onClick={async () => {
          // Save style prefs inline
          setBusy(true);
          try {
            await fetch('/api/onboarding/business', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
              body: JSON.stringify({ name: name.trim(), workspace_type: 'business', category }),
            }).catch(() => {});
          } finally { setBusy(false); }
          setStep('connect');
        }}>Continue →</Btn>
      </Footer>
    </Shell>
  );

  /* ── Connect: Bot token ───────────────────────────────────────── */
  if (step === 'connect') return (
    <Shell bg={C.bg}>
      <TopBar onBack={() => setStep('style')} step={3} total={3} />
      <div style={{ flex: 1, padding: '24px 20px 20px', overflowY: 'auto' }}>
        <Label sub="This is how MiniMe receives and replies to your client messages.">Connect your Telegram bot</Label>

        {/* BotFather steps */}
        <div style={{ marginTop: 18, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10, padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontFamily: BODY, fontSize: 11, fontWeight: 600, color: C.hint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>How to get a bot token</div>
          {[
            <>Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: C.primary }}>@BotFather</a> on Telegram</>,
            <>Send <code style={{ background: C.chip, padding: '1px 7px', borderRadius: 4, fontSize: 13, fontFamily: 'monospace', color: C.ink }}>/newbot</code></>,
            <>Give it a name and a username ending in <code style={{ background: C.chip, padding: '1px 7px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', color: C.ink }}>_bot</code></>,
            <>BotFather sends a token — paste it below ↓</>,
          ].map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: C.primary, color: '#FFF', fontFamily: BODY, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
              <span style={{ fontFamily: BODY, fontSize: 14, color: C.ink2, lineHeight: 1.5 }}>{step}</span>
            </div>
          ))}
        </div>

        {/* Token input */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: BODY, fontSize: 12, fontWeight: 600, color: C.ink, marginBottom: 8 }}>Your BotFather token</div>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
            style={{ ...inputStyle(), fontFamily: 'monospace', fontSize: 13 }}
            onFocus={e  => e.currentTarget.style.borderColor = C.primary}
            onBlur={e   => e.currentTarget.style.borderColor = C.line2}
          />
          <p style={{ fontFamily: BODY, fontSize: 11, color: C.hint, marginTop: 6 }}>
            🔒 Encrypted at rest — never stored in plain text.
          </p>
        </div>

        {err && (
          <div style={{ background: 'rgba(178,58,31,0.08)', border: '1px solid rgba(178,58,31,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#B23A1F', marginTop: 12, fontFamily: BODY }}>
            ❌ {err}
          </div>
        )}
      </div>
      <Footer>
        <Btn disabled={!token.trim() || busy} onClick={async () => {
          setBusy(true); setErr('');
          try {
            // Save teach / quiet hours defaults
            await fetch('/api/settings/hours', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
              body: JSON.stringify({ enabled: true, start_hour: 20, end_hour: 8, mode: 'auto_reply', message: "We're closed right now — I've got your message and will reply during business hours." }),
            }).catch(() => {});
            // Link bot
            const r = await fetch('/api/bot/link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
              body: JSON.stringify({ token: token.trim(), workspace_type: 'business' }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || 'Failed to link bot. Check the token and try again.');
            setLinkedBot(j.bot);
            setStep('done');
          } catch (e) { setErr(e.message); } finally { setBusy(false); }
        }}>
          {busy ? 'Connecting…' : 'Connect & finish →'}
        </Btn>
        <button
          onClick={() => setStep('done')}
          disabled={busy}
          style={{ display: 'block', width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: BODY, fontSize: 13, color: C.hint, marginTop: 14, textAlign: 'center' }}
        >
          Skip for now — connect later in Settings
        </button>
      </Footer>
    </Shell>
  );

  /* ── Done ─────────────────────────────────────────────────────── */
  if (step === 'done') return (
    <Shell bg={C.bg}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px', textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 20, animation: 'mmBounce .9s cubic-bezier(.34,1.56,.64,1)' }}>
          {linkedBot ? '🎉' : '✅'}
        </div>
        <h1 style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 34, fontWeight: 400, margin: 0, color: C.ink, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
          {linkedBot ? 'MiniMe is live.' : 'You\'re all set!'}
        </h1>
        {linkedBot ? (
          <p style={{ fontFamily: AMH, fontSize: 17, color: C.primary, margin: '10px 0 0' }}>
            ሥራዎ ተጀምሯል።
          </p>
        ) : null}

        <div style={{ marginTop: 28, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 12, padding: '20px 18px', maxWidth: 340, margin: '28px auto 0', width: '100%', textAlign: 'left' }}>
          {linkedBot ? (
            <>
              <div style={{ fontFamily: BODY, fontSize: 11, fontWeight: 600, color: C.hint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Your bot is ready</div>
              <a href={`https://t.me/${linkedBot.username}`} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', padding: '12px 14px', background: C.bg, borderRadius: 8, border: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 28 }}>🤖</span>
                <div>
                  <div style={{ fontFamily: BODY, fontWeight: 600, color: C.primary, fontSize: 15 }}>@{linkedBot.username}</div>
                  <div style={{ fontFamily: BODY, fontSize: 12, color: C.hint, marginTop: 2 }}>Send /start to test it ↗</div>
                </div>
              </a>
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  '✓ Webhook registered',
                  '✓ Voice profile saved',
                  '✓ Quiet hours set (8pm – 8am)',
                ].map((t, i) => (
                  <div key={i} style={{ fontFamily: BODY, fontSize: 13, color: C.green, display: 'flex', gap: 6 }}>{t}</div>
                ))}
              </div>
            </>
          ) : (
            <>
              <SummaryRow label="Business" value={name} />
              <SummaryRow label="Category" value={CATEGORIES.find(c => c.id === category)?.label || '—'} />
              <SummaryRow label="Language" value={language === 'amharic' ? 'Amharic' : language === 'mixed' ? 'Amharic + English' : 'English'} />
              <SummaryRow label="Tone" value={tone === 'warm' ? 'Warm & friendly' : tone === 'direct' ? 'Short & direct' : 'Professional'} last />
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(217,164,65,0.1)', border: '1px solid rgba(217,164,65,0.3)', borderRadius: 6, fontFamily: BODY, fontSize: 12, color: '#8B6508' }}>
                ⚠️ Connect your bot in Settings → Your Bot to go live.
              </div>
            </>
          )}
        </div>

        {linkedBot && (
          <div style={{ marginTop: 20, fontFamily: BODY, fontSize: 13, color: C.muted, maxWidth: 300, margin: '20px auto 0', lineHeight: 1.6 }}>
            Next: teach MiniMe your products and prices from the Knowledge tab.
          </div>
        )}
      </div>
      <Footer>
        <Btn primary onClick={() => router.push('/')}>Open my dashboard →</Btn>
        {linkedBot && (
          <a href={`https://t.me/${linkedBot.username}`} target="_blank" rel="noreferrer"
            style={{ display: 'block', textAlign: 'center', marginTop: 14, fontFamily: BODY, fontSize: 13, color: C.primary, textDecoration: 'none', fontWeight: 500 }}>
            Test @{linkedBot.username} in Telegram ↗
          </a>
        )}
      </Footer>
      <Anim />
    </Shell>
  );
}

// ─── Primitives ──────────────────────────────────────────────────────────────
function Shell({ bg = '#FBF6EC', children }) {
  return (
    <div style={{ minHeight: '100dvh', background: bg, display: 'flex', flexDirection: 'column', fontFamily: BODY, color: C.ink }}>
      {children}
    </div>
  );
}

function TopBar({ onBack, step, total }) {
  return (
    <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <button onClick={onBack} style={{ appearance: 'none', border: 'none', background: 'none', fontSize: 22, color: C.hint, cursor: 'pointer', lineHeight: 1, padding: '4px 6px', marginLeft: -6 }}>‹</button>
      <div style={{ flex: 1, display: 'flex', gap: 5, alignItems: 'center' }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ height: 3, flex: 1, borderRadius: 999, background: i < step ? C.primary : C.line, transition: 'background .2s' }} />
        ))}
      </div>
      <span style={{ fontFamily: BODY, fontSize: 12, color: C.hint }}>{step}/{total}</span>
    </div>
  );
}

function Label({ children, sub }) {
  return (
    <div>
      <h2 style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 26, color: C.ink, margin: 0, letterSpacing: '-0.02em', lineHeight: 1.25 }}>{children}</h2>
      {sub && <p style={{ fontFamily: BODY, fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>{sub}</p>}
    </div>
  );
}

function Footer({ children }) {
  return (
    <div style={{ padding: '16px 20px', paddingBottom: 'max(16px, env(safe-area-inset-bottom))', background: C.bg, borderTop: `1px solid ${C.line}` }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, disabled, primary = true }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', appearance: 'none', border: 'none',
        background: disabled ? '#C8B8A8' : C.primary,
        color: '#FFFFFF', padding: '16px', borderRadius: 10,
        fontSize: 16, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
        fontFamily: BODY, letterSpacing: '-0.01em',
        boxShadow: disabled ? 'none' : `0 4px 16px rgba(139,46,31,0.3)`,
        transition: 'all 120ms ease',
      }}
      onPointerDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.97)')}
      onPointerUp={e   => (e.currentTarget.style.transform = '')}
      onPointerLeave={e => (e.currentTarget.style.transform = '')}
    >
      {children}
    </button>
  );
}

function Err({ children }) {
  return <p style={{ fontFamily: BODY, fontSize: 13, color: '#B23A1F', marginTop: 8 }}>{children}</p>;
}

function SummaryRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: last ? 'none' : `1px solid ${C.line}` }}>
      <span style={{ fontFamily: BODY, fontSize: 13, color: C.hint }}>{label}</span>
      <span style={{ fontFamily: BODY, fontSize: 13, color: C.ink, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function inputStyle() {
  return {
    width: '100%', appearance: 'none', boxSizing: 'border-box',
    border: `1.5px solid ${C.line2}`, background: C.paper,
    borderRadius: 10, padding: '14px 16px', fontSize: 16,
    color: C.ink, fontFamily: BODY, outline: 'none', marginTop: 16,
    transition: 'border-color 150ms ease',
  };
}

function Anim() {
  return <style>{`@keyframes mmBounce{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}`}</style>;
}
