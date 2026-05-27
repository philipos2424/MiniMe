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
function Bubble({ msg, visible }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: msg.from === 'customer' ? 'flex-start' : 'flex-end',
      marginBottom: 8,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(12px)',
      transition: 'opacity 0.35s ease, transform 0.35s ease',
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
          background: msg.from === 'customer' ? '#E9E9EB' : msg.from === 'minime' ? MINT : '#007AFF',
          color: msg.from === 'customer' ? INK : '#fff',
          fontSize: 13.5, lineHeight: 1.4,
          boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
        }}>
          {msg.from === 'minime' && (
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.75, marginBottom: 4 }}>
              MINIME · AI
            </div>
          )}
          {msg.text}
          {msg.time && (
            <div style={{ fontSize: 9.5, opacity: 0.55, marginTop: 4, textAlign: 'right' }}>{msg.time}</div>
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
      width: '100%', maxWidth: 300,
      background: '#1C1C1E', borderRadius: 44,
      padding: '14px 4px',
      boxShadow: '0 32px 64px -16px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08)',
      position: 'relative',
      boxSizing: 'border-box',
    }}>
      {/* Notch */}
      <div style={{
        width: 110, height: 24, background: '#1C1C1E', borderRadius: 14,
        margin: '0 auto 8px', position: 'relative', zIndex: 2,
      }} />

      {/* Screen */}
      <div style={{
        background: PAPER, borderRadius: 34, overflow: 'hidden',
        margin: '0 4px',
      }}>
        {/* Chat header */}
        <div style={{
          background: accentColor || MINT, padding: '10px 14px 10px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
            display: 'grid', placeItems: 'center', fontSize: 17, flexShrink: 0,
          }}>🏪</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
          </div>
          {badge && (
            <div style={{
              marginLeft: 'auto', background: ERROR, borderRadius: 999, flexShrink: 0,
              padding: '2px 7px', fontSize: 11, fontWeight: 700, color: '#fff',
            }}>{badge}</div>
          )}
        </div>

        {/* Messages */}
        <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', minHeight: 200 }}>
          {messages.map((msg, i) => (
            <Bubble key={i} msg={msg} visible={i < visCount} />
          ))}
        </div>
      </div>

      {/* Home bar */}
      <div style={{
        width: 110, height: 4, background: 'rgba(255,255,255,0.3)',
        borderRadius: 2, margin: '10px auto 0',
      }} />
    </div>
  );
}

// ─── Chat data ────────────────────────────────────────────────────────────────
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
  { from: 'minime',  text: 'Selam! 🌿 Yes — navy M is in stock. 2,400 birr. Want me to hold one for you?', time: '08:14' },
  { from: 'customer', text: 'Yes please! Can I pay with Chapa?', time: '08:15' },
  { from: 'minime',  text: 'Done — held for you! Here\'s your payment link 👇', time: '08:15' },
  { from: 'minime',  text: '💳 Pay 2,400 birr → [Chapa link]', time: '08:15' },
];

// ─── BotFather steps ──────────────────────────────────────────────────────────
const BOT_STEPS = [
  {
    step: '01',
    title: 'Open @BotFather in Telegram',
    body: 'BotFather is Telegram\'s official bot maker. It\'s free and takes 2 minutes.',
    screen: [
      { from: 'customer', text: '/start' },
      { from: 'minime', text: '👋 Welcome to BotFather!\n\nI can help you create and manage Telegram bots.\n\nSend /newbot to create a new bot.' },
    ],
    cta: { label: 'Open @BotFather', href: 'https://t.me/BotFather' },
  },
  {
    step: '02',
    title: 'Send /newbot and choose a name',
    body: 'First give your bot a display name (e.g. "Selam Shop"). Then a username ending in "bot".',
    screen: [
      { from: 'customer', text: '/newbot' },
      { from: 'minime', text: 'Alright, a new bot. How are we going to call it?' },
      { from: 'customer', text: 'Selam Shop' },
      { from: 'minime', text: 'Good. Now choose a username — it must end in "bot".' },
      { from: 'customer', text: 'selamshopbot' },
    ],
  },
  {
    step: '03',
    title: 'Copy your token',
    body: 'BotFather gives you a long token — 7234567890:AAHd-xyz... Copy the whole thing.',
    screen: [
      { from: 'minime', text: 'Done! Congratulations on your new bot. You will find it at t.me/selamshopbot.\n\nYour token:\n7234567890:AAHd-xLMpKw...\n\nKeep your token secure.' },
      { from: 'customer', text: '(Copy the token 👆)' },
    ],
    highlight: true,
  },
  {
    step: '04',
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
        borderRadius: 14, padding: '14px 16px', cursor: 'pointer',
        transition: 'all .2s ease',
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}
    >
      <div style={{
        fontFamily: SERIF, fontSize: 20, fontStyle: 'italic',
        color: active ? GOLDSF : GOLD, flexShrink: 0, lineHeight: 1, marginTop: 2,
      }}>{step.step}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}>{step.title}</div>
        <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 4, lineHeight: 1.45 }}>{step.body}</div>
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
    <div style={{ background: PAPER, fontFamily: BODY, color: INK, overflowX: 'hidden', width: '100%' }}>
      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { transform: scale(1); opacity: 0.4; }
          30% { transform: scale(1.3); opacity: 1; }
        }
        * { box-sizing: border-box; }
      `}</style>

      {/* ── HERO ── */}
      <section style={{
        background: INK, color: PAPER,
        padding: 'max(52px, env(safe-area-inset-top)) 24px 48px',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.04, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(circle at 50% 0%, #fff 0%, transparent 70%)',
        }} />
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLDSF, marginBottom: 14 }}>
          A TALE OF TWO TUESDAYS
        </div>
        <h1 style={{ fontFamily: SERIF, fontSize: 'clamp(28px, 7vw, 48px)', fontWeight: 400, lineHeight: 1.05, margin: '0 0 16px', letterSpacing: '-0.025em' }}>
          Same shop.<br />
          <span style={{ fontStyle: 'italic', color: GOLDSF }}>Completely different day.</span>
        </h1>
        <p style={{ fontSize: 15, color: 'rgba(244,238,225,0.7)', maxWidth: 400, margin: '0 auto 28px', lineHeight: 1.6 }}>
          Watch how Sara runs the same Tuesday — once drowning in 47 unread messages, once sipping coffee while MiniMe handles everything.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/onboarding" style={{
            background: PAPER, color: INK, padding: '13px 24px', borderRadius: 999,
            textDecoration: 'none', fontWeight: 600, fontSize: 14,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            Set up in 90 seconds →
          </Link>
          <a href="#comparison" style={{
            background: 'rgba(255,255,255,0.1)', color: PAPER, padding: '13px 24px', borderRadius: 999,
            textDecoration: 'none', fontWeight: 500, fontSize: 14, border: '1px solid rgba(255,255,255,0.2)',
          }}>
            Watch the story ↓
          </a>
        </div>
      </section>

      {/* ── COMPARISON ── */}
      <section id="comparison" style={{ padding: '52px 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, marginBottom: 10 }}>THE COMPARISON</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(22px, 5vw, 34px)', fontWeight: 400, margin: 0, letterSpacing: '-0.02em' }}>
              Tuesday, 8:14am —<br />one message, two outcomes
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 28, justifyItems: 'center' }}>

            {/* WITHOUT */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%', maxWidth: 320 }}>
              <div style={{
                background: 'rgba(184,84,80,0.08)', border: '1px solid rgba(184,84,80,0.2)',
                borderRadius: 12, padding: '9px 18px', fontSize: 12.5, fontWeight: 700, color: ERROR,
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>❌ Without MiniMe</div>
              <PhoneMockup
                messages={WITHOUT_MESSAGES}
                title="Selam Boutique"
                subtitle="No replies for 3 hours"
                accentColor={ERROR}
                badge="47"
              />
              <div style={{ background: 'rgba(184,84,80,0.06)', borderRadius: 14, padding: '14px 16px', width: '100%' }}>
                <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 13.5, color: INK, lineHeight: 1.8 }}>
                  <li>Sara was in a meeting ☎️</li>
                  <li>Customer waited 3+ hours</li>
                  <li>By the time Sara replied, they'd bought elsewhere 😞</li>
                  <li>Lost sale: <strong style={{ color: ERROR }}>2,400 ETB</strong></li>
                </ul>
              </div>
            </div>

            {/* WITH */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%', maxWidth: 320 }}>
              <div style={{
                background: 'rgba(79,163,138,0.1)', border: '1px solid rgba(79,163,138,0.25)',
                borderRadius: 12, padding: '9px 18px', fontSize: 12.5, fontWeight: 700, color: MINT,
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>✅ With MiniMe</div>
              <PhoneMockup
                messages={WITH_MESSAGES}
                title="Selam Boutique"
                subtitle="MiniMe • Active"
                accentColor={MINT}
              />
              <div style={{ background: 'rgba(79,163,138,0.06)', borderRadius: 14, padding: '14px 16px', width: '100%' }}>
                <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 13.5, color: INK, lineHeight: 1.8 }}>
                  <li>MiniMe replied in <strong>2 seconds</strong> ⚡</li>
                  <li>Checked stock, quoted price</li>
                  <li>Sent Chapa payment link</li>
                  <li>Earned: <strong style={{ color: MINT }}>2,400 ETB</strong> 💚</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT MINIME DOES ── */}
      <section style={{ background: INK, color: PAPER, padding: '52px 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLDSF, marginBottom: 14 }}>WHAT MINIME HANDLES</div>
          <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(22px, 5vw, 34px)', fontWeight: 400, margin: '0 0 36px', letterSpacing: '-0.02em' }}>
            While you run your business,<br /><span style={{ fontStyle: 'italic', color: GOLDSF }}>MiniMe runs your inbox.</span>
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, textAlign: 'left' }}>
            {[
              { icon: '💬', title: 'Price questions', body: '"How much is the bag?" → MiniMe quotes the exact price instantly.' },
              { icon: '📦', title: 'Orders', body: '"I want 2 of those" → creates the order and sends a payment link.' },
              { icon: '📍', title: 'Location & hours', body: '"Where are you?" → shares your address, map link, and opening times.' },
              { icon: '🚚', title: 'Delivery', body: '"Do you deliver to Bole?" → confirms, quotes the fee, arranges it.' },
              { icon: '🎨', title: 'Custom orders', body: 'Collects design, size, deadline, budget — then passes to you.' },
              { icon: '📅', title: 'Bookings', body: 'Takes reservations and confirms slots for salons, restaurants, services.' },
              { icon: '🔄', title: 'Follow-ups', body: 'Reminds customers who haven\'t paid, asks for delivery feedback.' },
              { icon: '🌙', title: '3am messages', body: 'A customer messages at midnight. MiniMe replies in 2 seconds. You sleep.' },
            ].map((f, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '16px 14px',
                border: '1px solid rgba(255,255,255,0.08)',
              }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 5 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(244,238,225,0.6)', lineHeight: 1.55 }}>{f.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ padding: '48px 20px', background: CREAM }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {STATS.map(s => (
              <div key={s.n} style={{ textAlign: 'center', padding: '20px 12px', background: '#fff', borderRadius: 14, border: `1px solid ${LINE}` }}>
                <div style={{ fontFamily: SERIF, fontSize: 36, fontWeight: 400, color: INK, letterSpacing: '-0.02em', lineHeight: 1 }}>{s.n}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginTop: 6 }}>{s.label}</div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, lineHeight: 1.4 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: '52px 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, marginBottom: 10 }}>HOW IT WORKS</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(22px, 5vw, 34px)', fontWeight: 400, margin: 0, letterSpacing: '-0.02em' }}>
              Set up in 90 seconds
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {[
              { n: '1', icon: '📝', title: 'Name your business', body: 'Tell MiniMe your business name and category.' },
              { n: '2', icon: '🤖', title: 'Create a bot', body: 'Open @BotFather, create a free bot, copy the token.' },
              { n: '3', icon: '🪞', title: 'Connect to MiniMe', body: 'Paste the token. MiniMe mirrors your bot instantly.' },
              { n: '4', icon: '📦', title: 'Add your products', body: 'Add what you sell. MiniMe quotes exact prices.' },
            ].map(s => (
              <div key={s.n} style={{
                background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '16px 14px',
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  fontFamily: SERIF, fontStyle: 'italic', fontSize: 40, color: CREAM2,
                  position: 'absolute', top: 6, right: 12, lineHeight: 1, fontWeight: 400,
                }}>{s.n}</div>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 5 }}>{s.title}</div>
                <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BOTFATHER GUIDE ── */}
      <section id="botfather" style={{ background: CREAM, padding: '52px 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, marginBottom: 10 }}>STEP-BY-STEP</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(22px, 5vw, 34px)', fontWeight: 400, margin: '0 0 10px', letterSpacing: '-0.02em' }}>
              How to create your Telegram bot
            </h2>
            <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>
              @BotFather is Telegram's official bot maker. Free. Takes 2 minutes.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            {BOT_STEPS.map((step, i) => (
              <BotStepCard key={i} step={step} active={botStep === i} onClick={() => setBotStep(i)} />
            ))}
          </div>

          {/* Preview */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {BOT_STEPS[botStep].isMinime ? (
              <div style={{
                width: '100%', maxWidth: 320,
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
              <PhoneMockup
                messages={BOT_STEPS[botStep].screen || []}
                title="BotFather"
                subtitle="Telegram"
                accentColor="#229ED9"
              />
            )}
          </div>
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
      </section>

      {/* ── CTA ── */}
      <section style={{
        background: `linear-gradient(135deg, ${INK} 0%, #1A3C35 100%)`,
        color: PAPER,
        padding: '60px 24px',
        paddingBottom: 'max(60px, env(safe-area-inset-bottom))',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLDSF, marginBottom: 14 }}>
          READY TO START?
        </div>
        <h2 style={{ fontFamily: SERIF, fontSize: 'clamp(24px, 6vw, 40px)', fontWeight: 400, margin: '0 0 14px', letterSpacing: '-0.025em' }}>
          Your first customer deserves<br />
          <span style={{ fontStyle: 'italic', color: GOLDSF }}>a reply in 2 seconds.</span>
        </h2>
        <p style={{ fontSize: 15, color: 'rgba(244,238,225,0.65)', maxWidth: 380, margin: '0 auto 32px', lineHeight: 1.6 }}>
          Free 14-day trial. No credit card. Setup takes 90 seconds.
        </p>
        <Link href="/onboarding" style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          background: PAPER, color: INK,
          padding: '15px 32px', borderRadius: 999, textDecoration: 'none',
          fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em',
          boxShadow: '0 8px 32px -8px rgba(0,0,0,0.4)',
        }}>
          Set up MiniMe — it's free →
        </Link>
        <div style={{ marginTop: 18, fontSize: 13, color: 'rgba(244,238,225,0.4)' }}>
          Already have an account? <Link href="/" style={{ color: GOLDSF, textDecoration: 'none' }}>Open MiniMe →</Link>
        </div>
      </section>
    </div>
  );
}
