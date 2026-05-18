'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK    = '#0E2823';
const PAPER  = '#FBF8F1';
const CREAM  = '#F4EEE1';
const CREAM2 = '#EDE6D6';
const GOLD   = '#B08A4A';
const GOLDSF = '#D4B987';
const MINT   = '#4FA38A';
const LINE   = '#E4DED1';
const MUTED  = '#8A9590';
const ERROR  = '#B85450';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const MONO   = "'Geist Mono', ui-monospace, monospace";

// ─── Animated chat bubble ────────────────────────────────────────────────────
function Bubble({ msg, delay = 0, visible }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: msg.from === 'customer' ? 'flex-start' : 'flex-end',
      marginBottom: 8,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(12px)',
      transition: `opacity 0.35s ease ${delay}s, transform 0.35s ease ${delay}s`,
    }}>
      {msg.from === 'typing' ? (
        <div style={{
          background: '#E9E9EB', borderRadius: '18px 18px 18px 4px',
          padding: '10px 16px', display: 'flex', gap: 4, alignItems: 'center',
        }}>
          {[0,1,2].map(i => (
            <span key={i} style={{
              width: 7, height: 7, borderRadius: '50%', background: '#8A8A8E',
              display: 'inline-block',
              animation: 'typingDot 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}/>
          ))}
        </div>
      ) : (
        <div style={{
          maxWidth: '78%', padding: '10px 14px',
          borderRadius: msg.from === 'customer' ? '18px 18px 18px 4px' : '18px 18px 4px 18px',
          background: msg.from === 'customer' ? '#E9E9EB' : msg.from === 'alfred' ? MINT : '#007AFF',
          color: msg.from === 'customer' ? INK : '#fff',
          fontSize: 14.5, lineHeight: 1.4,
          boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
        }}>
          {msg.from === 'alfred' && (
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.75, marginBottom: 4 }}>
              ALFRED · AI
            </div>
          )}
          {msg.text}
          {msg.time && (
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4, textAlign: 'right' }}>{msg.time}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Animated phone mockup ───────────────────────────────────────────────────
function PhoneMockup({ messages, title, subtitle, accentColor, badge }) {
  const [visCount, setVisCount] = useState(0);

  useEffect(() => {
    setVisCount(0);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setVisCount(i);
      if (i >= messages.length) clearInterval(iv);
    }, 700);
    return () => clearInterval(iv);
  }, [messages.length]);

  return (
    <div style={{
      width: 300, flexShrink: 0,
      background: '#1C1C1E', borderRadius: 44,
      padding: '14px 4px',
      boxShadow: '0 32px 64px -16px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08)',
      position: 'relative',
    }}>
      {/* Notch */}
      <div style={{
        width: 120, height: 26, background: '#1C1C1E', borderRadius: 14,
        margin: '0 auto 8px', position: 'relative', zIndex: 2,
      }} />

      {/* Screen */}
      <div style={{
        background: PAPER, borderRadius: 34, overflow: 'hidden',
        margin: '0 4px', minHeight: 520,
      }}>
        {/* Status bar */}
        <div style={{
          background: accentColor || MINT, padding: '10px 16px 10px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
            display: 'grid', placeItems: 'center', fontSize: 18, flexShrink: 0,
          }}>🏪</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{title}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{subtitle}</div>
          </div>
          {badge && (
            <div style={{
              marginLeft: 'auto', background: ERROR, borderRadius: 999,
              padding: '2px 7px', fontSize: 11, fontWeight: 700, color: '#fff',
            }}>{badge}</div>
          )}
        </div>

        {/* Messages */}
        <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column' }}>
          {messages.map((msg, i) => (
            <Bubble key={i} msg={msg} visible={i < visCount} delay={0} />
          ))}
        </div>
      </div>

      {/* Home bar */}
      <div style={{
        width: 120, height: 4, background: 'rgba(255,255,255,0.3)',
        borderRadius: 2, margin: '10px auto 0',
      }} />
    </div>
  );
}

// ─── Section: Without MiniMe ─────────────────────────────────────────────────
const WITHOUT_MESSAGES = [
  { from: 'customer', text: 'Selam! Do you have the navy dress in size M?', time: '08:14' },
  { from: 'customer', text: 'Hello? Is anyone there?', time: '08:45' },
  { from: 'customer', text: 'I need it for tomorrow!', time: '09:02' },
  { from: 'owner',    text: 'Sorry for the delay! Yes we have it, 2,400 birr', time: '11:30' },
  { from: 'customer', text: 'OK but I already bought it elsewhere 😞', time: '11:32' },
];

const WITH_MESSAGES = [
  { from: 'customer', text: 'Selam! Do you have the navy dress in size M?', time: '08:14' },
  { from: 'typing'  },
  { from: 'alfred',  text: 'Selam! 🌿 Yes — navy M is in stock. 2,400 birr. Want me to hold one for you?', time: '08:14' },
  { from: 'customer', text: 'Yes please! Can I pay with Chapa?', time: '08:15' },
  { from: 'alfred',  text: 'Done — held for you! Here\'s your payment link 👇', time: '08:15' },
  { from: 'alfred',  text: '💳 Pay 2,400 birr → [Chapa link]', time: '08:15' },
];

// ─── BotFather Guide ─────────────────────────────────────────────────────────
const BOT_STEPS = [
  {
    step: '01',
    icon: '📱',
    title: 'Open @BotFather in Telegram',
    body: 'BotFather is Telegram\'s official bot maker. It\'s free and takes 2 minutes.',
    screen: [
      { from: 'customer', text: '/start' },
      { from: 'alfred', text: '👋 Welcome to BotFather!\n\nI can help you create and manage Telegram bots.\n\nSend /newbot to create a new bot.' },
    ],
    cta: { label: 'Open @BotFather', href: 'https://t.me/BotFather' },
  },
  {
    step: '02',
    icon: '✍️',
    title: 'Send /newbot and choose a name',
    body: 'First give your bot a display name (e.g. "Selam Shop"). Then a username ending in "bot" (e.g. "selamshopbot").',
    screen: [
      { from: 'customer', text: '/newbot' },
      { from: 'alfred', text: 'Alright, a new bot. How are we going to call it? Please choose a name for your bot.' },
      { from: 'customer', text: 'Selam Shop' },
      { from: 'alfred', text: 'Good. Now let\'s choose a username for your bot. It must end in "bot". Like this: TetrisBot or tetris_bot.' },
      { from: 'customer', text: 'selamshopbot' },
    ],
  },
  {
    step: '03',
    icon: '🔑',
    title: 'Copy your token',
    body: 'BotFather gives you a long token — something like 7234567890:AAHd-xyz... Copy the whole thing.',
    screen: [
      { from: 'alfred', text: 'Done! Congratulations on your new bot. You will find it at t.me/selamshopbot.\n\nUse this token to access the HTTP API:\n\n7234567890:AAHd-xLMpKwQ8f2NmJ4...\n\nKeep your token secure.' },
      { from: 'customer', text: '(Copy the token 👆)' },
    ],
    highlight: true,
  },
  {
    step: '04',
    icon: '🪞',
    title: 'Paste it into MiniMe',
    body: 'Go back to MiniMe → paste the token → tap "Connect bot". That\'s it. Your bot is live.',
    isMinime: true,
  },
];

function BotStepCard({ step, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? INK : '#fff', color: active ? PAPER : INK,
        border: `1.5px solid ${active ? INK : LINE}`,
        borderRadius: 16, padding: '16px 18px', cursor: 'pointer',
        transition: 'all .2s ease',
        display: 'flex', gap: 14, alignItems: 'flex-start',
      }}
    >
      <div style={{
        fontFamily: SERIF, fontSize: 22, fontStyle: 'italic',
        color: active ? GOLDSF : GOLD, flexShrink: 0, lineHeight: 1, marginTop: 2,
      }}>{step.step}</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2 }}>{step.title}</div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4, lineHeight: 1.45 }}>{step.body}</div>
        {step.cta && active && (
          <a href={step.cta.href} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
            background: GOLD, color: '#fff', padding: '7px 14px', borderRadius: 999,
            fontSize: 13, fontWeight: 600, textDecoration: 'none',
          }}>
            {step.cta.label} →
          </a>
        )}
      </div>
    </div>
  );
}

function MiniMeTokenInput() {
  const [val, setVal] = useState('');
  const looks = val.length > 15 && val.includes(':');
  return (
    <div style={{ padding: 16, background: PAPER, borderRadius: 12 }}>
      <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Paste token here</div>
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="7234567890:AAHd-…"
        style={{
          width: '100%', boxSizing: 'border-box', fontFamily: MONO, fontSize: 12,
          padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${looks ? MINT : LINE}`,
          background: '#fff', color: INK, outline: 'none',
        }}
      />
      {looks && (
        <div style={{ color: MINT, fontSize: 13, marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>✓</span> Token looks valid — tap Connect
        </div>
      )}
      <button style={{
        width: '100%', marginTop: 10, padding: '12px', borderRadius: 999,
        background: looks ? INK : '#C8C0B8', color: PAPER,
        border: 'none', fontSize: 14, fontWeight: 600, cursor: looks ? 'pointer' : 'default',
        fontFamily: BODY,
      }}>Connect bot →</button>
    </div>
  );
}

// ─── Stats strip ─────────────────────────────────────────────────────────────
const STATS = [
  { n: '24/7', label: 'Always on', sub: 'Replies at 2am like it\'s 10am' },
  { n: '< 2s', label: 'Response time', sub: 'Faster than any human assistant' },
  { n: '80%', label: 'Auto-handled', sub: 'Questions answered without you' },
  { n: '0',   label: 'Missed messages', sub: 'Every customer gets a reply' },
];

// ─── Main page ────────────────────────────────────────────────────────────────
export default function DemoPage() {
  const [botStep, setBotStep] = useState(0);

  return (
    <div style={{ background: PAPER, fontFamily: BODY, color: INK, overflowX: 'hidden' }}>
      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { transform: scale(1); opacity: 0.4; }
          30% { transform: scale(1.3); opacity: 1; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-in-up { animation: fadeUp 0.6s ease both; }
      `}</style>

      {/* ── HERO ── */}
      <section style={{
        background: INK, color: PAPER, padding: '60px 24px 50px',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: 'radial-gradient(circle at 50% 0%, #fff 0%, transparent 70%)',
        }} />
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLDSF, marginBottom: 16 }}>
          A TALE OF TWO TUESDAYS
        </div>
        <h1 style={{ fontFamily: SERIF, fontSize: 'clamp(32px, 8vw, 52px)', fontWeight: 400, lineHeight: 1.05, margin: '0 0 20px', letterSpacing: '-0.025em' }}>
          Same shop.<br />
          <span style={{ fontStyle: 'italic', color: GOLDSF }}>Completely different day.</span>
        </h1>
        <p style={{ fontSize: 16, color: 'rgba(244,238,225,0.7)', maxWidth: 480, margin: '0 auto 32px', lineHeight: 1.6 }}>
          Watch how Sara runs the same Tuesday — once drowning in 47 unread messages, once sipping coffee while Alfred handles everything.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/onboarding" style={{
            background: PAPER, color: INK, padding: '14px 28px', borderRadius: 999,
            textDecoration: 'none', fontWeight: 600, fontSize: 15,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            Set up in 90 seconds →
          </Link>
          <a href="#comparison" style={{
            background: 'rgba(255,255,255,0.1)', color: PAPER, padding: '14px 28px', borderRadius: 999,
            textDecoration: 'none', fontWeight: 500, fontSize: 15, border: '1px solid rgba(255,255,255,0.2)',
          }}>
            Watch the story ↓
          </a>
        </div>
      </section>

      {/* ── COMPARISON ── */}
      <section id="comparison" style={{ padding: '64px 24px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, marginBottom: 12 }}>THE COMPARISON</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(26px, 5vw, 38px)', fontWeight: 400, margin: 0, letterSpacing: '-0.02em' }}>
              Tuesday, 8:14am — one message, two outcomes
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32, justifyItems: 'center' }}>

            {/* WITHOUT */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
              <div style={{
                background: 'rgba(184,84,80,0.08)', border: '1px solid rgba(184,84,80,0.2)',
                borderRadius: 12, padding: '10px 20px', fontSize: 13, fontWeight: 700, color: ERROR,
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>❌ Without MiniMe</div>
              <PhoneMockup
                messages={WITHOUT_MESSAGES}
                title="Selam Boutique"
                subtitle="No replies for 3 hours"
                accentColor={ERROR}
                badge="47"
              />
              <div style={{ background: 'rgba(184,84,80,0.06)', borderRadius: 14, padding: '16px 20px', maxWidth: 300, width: '100%' }}>
                <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 14, color: INK, lineHeight: 1.8 }}>
                  <li>Sara was in a meeting ☎️</li>
                  <li>Customer waited 3+ hours</li>
                  <li>By the time Sara replied, they'd bought elsewhere 😞</li>
                  <li>Lost sale: <strong style={{ color: ERROR }}>2,400 ETB</strong></li>
                </ul>
              </div>
            </div>

            {/* WITH */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
              <div style={{
                background: 'rgba(79,163,138,0.1)', border: '1px solid rgba(79,163,138,0.25)',
                borderRadius: 12, padding: '10px 20px', fontSize: 13, fontWeight: 700, color: MINT,
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>✅ With MiniMe</div>
              <PhoneMockup
                messages={WITH_MESSAGES}
                title="Selam Boutique"
                subtitle="Alfred • Active"
                accentColor={MINT}
              />
              <div style={{ background: 'rgba(79,163,138,0.06)', borderRadius: 14, padding: '16px 20px', maxWidth: 300, width: '100%' }}>
                <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 14, color: INK, lineHeight: 1.8 }}>
                  <li>Alfred replied in <strong>2 seconds</strong> ⚡</li>
                  <li>Checked stock, quoted price</li>
                  <li>Sent Chapa payment link</li>
                  <li>Earned: <strong style={{ color: MINT }}>2,400 ETB</strong> 💚</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT ALFRED DOES ── */}
      <section style={{ background: INK, color: PAPER, padding: '64px 24px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLDSF, marginBottom: 16 }}>WHAT ALFRED HANDLES</div>
          <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(24px, 5vw, 36px)', fontWeight: 400, margin: '0 0 40px', letterSpacing: '-0.02em' }}>
            While you run your business,<br /><span style={{ fontStyle: 'italic', color: GOLDSF }}>Alfred runs your inbox.</span>
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, textAlign: 'left' }}>
            {[
              { icon: '💬', title: 'Price questions', body: '"How much is the bag?" → Alfred quotes the exact price from your catalog instantly.' },
              { icon: '📦', title: 'Orders', body: 'Customer says "I want 2 of those" → Alfred creates the order and sends a payment link.' },
              { icon: '📍', title: 'Location & hours', body: '"Where are you?" → Alfred shares your address, map link, and opening times.' },
              { icon: '🚚', title: 'Delivery', body: '"Do you deliver to Bole?" → Alfred confirms, quotes the fee, and arranges it.' },
              { icon: '🎨', title: 'Custom orders', body: 'Collects all the details — design, size, deadline, budget — before passing to you.' },
              { icon: '📅', title: 'Bookings', body: 'For salons, restaurants, services — Alfred takes reservations and confirms slots.' },
              { icon: '🔄', title: 'Follow-ups', body: 'Reminds customers who haven\'t paid, asks for delivery feedback, re-engages inactive buyers.' },
              { icon: '🌙', title: '3am messages', body: 'A customer messages at midnight. Alfred replies within 2 seconds. You sleep.' },
            ].map((f, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: '18px 16px',
                border: '1px solid rgba(255,255,255,0.08)',
              }}>
                <div style={{ fontSize: 24, marginBottom: 10 }}>{f.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 12.5, color: 'rgba(244,238,225,0.6)', lineHeight: 1.55 }}>{f.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ padding: '56px 24px', background: CREAM }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            {STATS.map(s => (
              <div key={s.n} style={{ textAlign: 'center', padding: '24px 16px' }}>
                <div style={{ fontFamily: SERIF, fontSize: 42, fontWeight: 400, color: INK, letterSpacing: '-0.02em', lineHeight: 1 }}>{s.n}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginTop: 8 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.4 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: '64px 24px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, marginBottom: 12 }}>HOW IT WORKS</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(24px, 5vw, 36px)', fontWeight: 400, margin: 0, letterSpacing: '-0.02em' }}>
              Your bot, your voice — set up in 90 seconds
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {[
              { n: '1', icon: '📝', title: 'Name your business', body: 'Tell MiniMe your business name, category, and preferred tone.' },
              { n: '2', icon: '🤖', title: 'Create a Telegram bot', body: 'Open @BotFather, create a free bot, copy the token. Takes 2 minutes.' },
              { n: '3', icon: '🪞', title: 'Connect to MiniMe', body: 'Paste the token. Alfred mirrors your bot and starts handling messages.' },
              { n: '4', icon: '📦', title: 'Add your products', body: 'Add what you sell with prices. Alfred will quote them exactly to every customer.' },
            ].map(s => (
              <div key={s.n} style={{
                background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 20,
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  fontFamily: SERIF, fontStyle: 'italic', fontSize: 48, color: CREAM2,
                  position: 'absolute', top: 8, right: 14, lineHeight: 1, fontWeight: 400,
                }}>{s.n}</div>
                <div style={{ fontSize: 26, marginBottom: 10 }}>{s.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BOTFATHER GUIDE ── */}
      <section id="botfather" style={{ background: CREAM, padding: '64px 24px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, marginBottom: 12 }}>STEP-BY-STEP</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(24px, 5vw, 36px)', fontWeight: 400, margin: '0 0 12px', letterSpacing: '-0.02em' }}>
              How to create your Telegram bot
            </h2>
            <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>
              @BotFather is Telegram's official bot maker. It's free and takes exactly 2 minutes.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, alignItems: 'start' }}>
            {/* Steps list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {BOT_STEPS.map((step, i) => (
                <BotStepCard key={i} step={step} active={botStep === i} onClick={() => setBotStep(i)} />
              ))}
            </div>

            {/* Preview */}
            <div style={{ position: 'sticky', top: 24 }}>
              {BOT_STEPS[botStep].isMinime ? (
                <div style={{
                  width: '100%', maxWidth: 320, margin: '0 auto',
                  background: INK, borderRadius: 24, padding: '24px 20px',
                }}>
                  <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 22, color: CREAM, marginBottom: 4 }}>minime</div>
                  <div style={{ fontSize: 11, color: 'rgba(244,238,225,0.4)', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 20 }}>connect your bot</div>
                  <MiniMeTokenInput />
                  <p style={{ fontSize: 11, color: 'rgba(244,238,225,0.4)', textAlign: 'center', marginTop: 12 }}>
                    🔒 Token encrypted — never stored in plain text
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <PhoneMockup
                    messages={BOT_STEPS[botStep].screen || []}
                    title="BotFather"
                    subtitle="Telegram"
                    accentColor="#229ED9"
                  />
                </div>
              )}
              {BOT_STEPS[botStep].highlight && (
                <div style={{
                  marginTop: 16, background: 'rgba(176,138,74,0.12)', border: '1px solid rgba(176,138,74,0.3)',
                  borderRadius: 12, padding: '12px 16px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: GOLD }}>⚠️ Keep your token secret</div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                    Anyone with your token can control your bot. Only paste it in MiniMe.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{
        background: `linear-gradient(135deg, ${INK} 0%, #1A3C35 100%)`,
        color: PAPER, padding: '72px 24px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLDSF, marginBottom: 16 }}>
          READY TO START?
        </div>
        <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(28px, 6vw, 44px)', fontWeight: 400, margin: '0 0 16px', letterSpacing: '-0.025em' }}>
          Your first customer deserves<br />
          <span style={{ fontStyle: 'italic', color: GOLDSF }}>a reply in 2 seconds.</span>
        </h2>
        <p style={{ fontSize: 16, color: 'rgba(244,238,225,0.65)', maxWidth: 420, margin: '0 auto 36px', lineHeight: 1.6 }}>
          Free 14-day trial. No credit card. Setup takes 90 seconds.
        </p>
        <Link href="/onboarding" style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          background: PAPER, color: INK,
          padding: '16px 36px', borderRadius: 999, textDecoration: 'none',
          fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em',
          boxShadow: '0 8px 32px -8px rgba(0,0,0,0.4)',
        }}>
          Set up MiniMe — it's free →
        </Link>
        <div style={{ marginTop: 20, fontSize: 13, color: 'rgba(244,238,225,0.4)' }}>
          Already have an account? <Link href="/" style={{ color: GOLDSF, textDecoration: 'none' }}>Open MiniMe →</Link>
        </div>
      </section>
    </div>
  );
}
