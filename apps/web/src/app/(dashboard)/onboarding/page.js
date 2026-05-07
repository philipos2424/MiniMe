'use client';
/**
 * Onboarding v2 — minimalist mobile, one question per screen.
 *
 * Steps:
 *   welcome → name → category → language → tone → hours → voice → teach → done
 *
 * New: business category step, "teach MiniMe" quick-start step.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../lib/design-tokens';

const STEPS = ['welcome', 'name', 'category', 'language', 'tone', 'hours', 'voice', 'teach', 'done'];

const CATEGORIES = [
  { id: 'electronics', emoji: '📱', label: 'Electronics & Tech', sub: 'Phones, accessories, gadgets' },
  { id: 'clothing',    emoji: '👗', label: 'Clothing & Fashion', sub: 'Apparel, shoes, accessories' },
  { id: 'food',        emoji: '🍽', label: 'Food & Restaurant',  sub: 'Meals, delivery, catering' },
  { id: 'beauty',      emoji: '💅', label: 'Beauty & Wellness',  sub: 'Salon, spa, cosmetics' },
  { id: 'onlineshop',  emoji: '🛒', label: 'Online Shop',        sub: 'E-commerce, imports, resale' },
  { id: 'services',    emoji: '🔧', label: 'Professional Services', sub: 'Consulting, design, repairs' },
  { id: 'homegifts',   emoji: '🏠', label: 'Home & Gifts',       sub: 'Furniture, décor, crafts' },
  { id: 'other',       emoji: '🏢', label: 'Other Business',     sub: "I'll describe it myself" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { initData, business, telegramUser, loading } = useTelegram() || {};
  const [step, setStep]         = useState('welcome');
  const [name, setName]         = useState('');
  const [category, setCategory] = useState('');
  const [language, setLanguage] = useState('');
  const [tone, setTone]         = useState('');
  const [hours, setHours]       = useState('');
  const [sample, setSample]     = useState('');
  const [teachItems, setTeachItems] = useState([{ q: '', a: '' }]);
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');
  const [linkedBot, setLinkedBot] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (business?.telegram_bot_username) router.replace('/');
    else if (business?.name) {
      setName(business.name);
      setStep('language');
    }
  }, [loading, business, router]);

  if (loading) return <FullScreen><div style={{ color: COLORS.textHint, margin: 'auto' }}>Loading…</div></FullScreen>;

  // ───────── Welcome ─────────
  if (step === 'welcome') return (
    <FullScreen>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 24px', textAlign: 'center' }}>
        {/* Animated logo */}
        <div style={{
          width: 96, height: 96, borderRadius: 28, marginBottom: 28,
          background: `linear-gradient(135deg, ${COLORS.teal} 0%, #0F766E 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 16px 48px rgba(13,148,136,0.35)`,
          fontSize: 48, animation: 'mmBounce 0.8s cubic-bezier(0.34,1.56,0.64,1)',
        }}>🤖</div>

        <h1 style={{
          fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400,
          fontSize: 36, color: COLORS.textPrimary, margin: 0, lineHeight: 1.1, letterSpacing: '-0.03em',
        }}>
          Meet MiniMe
        </h1>
        <p style={{ fontSize: 17, color: COLORS.textSecondary, marginTop: 14, lineHeight: 1.6, maxWidth: 300 }}>
          Your AI assistant that handles client messages — in your exact voice, 24/7.
        </p>

        {/* Mini feature list */}
        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320, textAlign: 'left' }}>
          {[
            ['⚡', 'Replies in seconds, not hours'],
            ['🎯', 'Learns your products & prices'],
            ['🤝', 'Sounds exactly like you'],
          ].map(([icon, text], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: COLORS.surface, borderRadius: RADII.md, border: `1px solid ${COLORS.border}`, boxShadow: SHADOW.card }}>
              <span style={{ fontSize: 20 }}>{icon}</span>
              <span style={{ fontSize: 14, color: COLORS.textPrimary, fontWeight: 500 }}>{text}</span>
            </div>
          ))}
        </div>
      </div>
      <BottomBar>
        <PrimaryBtn onClick={() => setStep('name')}>Get started — 2 min setup →</PrimaryBtn>
        <a href="/demo" style={{ display: 'block', textAlign: 'center', marginTop: 14, fontSize: 13, color: COLORS.textSecondary, textDecoration: 'none', fontFamily: FONT.body }}>
          ✨ Watch a story first →
        </a>
      </BottomBar>
      <style>{`
        @keyframes mmBounce{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
      `}</style>
    </FullScreen>
  );

  // ───────── Step 1 — Name ─────────
  if (step === 'name') return (
    <FullScreen>
      <Top onBack={() => setStep('welcome')}><Dots current={1} total={7} /></Top>
      <Body>
        <Question>What is your business name?</Question>
        <Hint>Clients will see this name when MiniMe replies</Hint>
        <input
          value={name} onChange={e => setName(e.target.value)} autoFocus
          placeholder="e.g. Hana Electronics, Selam Boutique…"
          style={textInput()}
          onFocus={e => e.currentTarget.style.borderColor = COLORS.teal}
          onBlur={e => e.currentTarget.style.borderColor = COLORS.border}
        />
      </Body>
      <BottomBar>
        <PrimaryBtn disabled={!name.trim() || busy} onClick={async () => {
          setBusy(true); setErr('');
          try {
            const r = await fetch('/api/onboarding/business', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
              body: JSON.stringify({ name: name.trim(), workspace_type: 'business' }),
            });
            if (!r.ok) throw new Error((await r.json()).error || 'failed');
            setStep('category');
          } catch (e) { setErr(e.message); } finally { setBusy(false); }
        }}>Continue →</PrimaryBtn>
        {err && <ErrText>{err}</ErrText>}
      </BottomBar>
    </FullScreen>
  );

  // ───────── Step 2 — Category ─────────
  if (step === 'category') return (
    <FullScreen>
      <Top onBack={() => setStep('name')}><Dots current={2} total={7} /></Top>
      <Body>
        <Question>What type of business?</Question>
        <Hint>MiniMe uses this to give smarter replies for your industry</Hint>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
          {CATEGORIES.map(cat => (
            <button key={cat.id} onClick={() => setCategory(cat.id)} style={{
              appearance: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              border: `2px solid ${category === cat.id ? COLORS.teal : COLORS.border}`,
              background: category === cat.id ? COLORS.tealLight : COLORS.surface,
              borderRadius: RADII.lg, padding: '14px 12px',
              boxShadow: SHADOW.card, transition: 'all 150ms ease',
            }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>{cat.emoji}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, lineHeight: 1.2 }}>{cat.label}</div>
              <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 3, lineHeight: 1.4 }}>{cat.sub}</div>
            </button>
          ))}
        </div>
      </Body>
      <BottomBar>
        <PrimaryBtn disabled={!category} onClick={async () => {
          // Save category
          setBusy(true);
          try {
            await fetch('/api/onboarding/business', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
              body: JSON.stringify({ name: name.trim(), workspace_type: 'business', category }),
            }).catch(() => {});
          } finally { setBusy(false); }
          setStep('language');
        }}>Continue →</PrimaryBtn>
      </BottomBar>
    </FullScreen>
  );

  // ───────── Step 3 — Language ─────────
  if (step === 'language') return (
    <FullScreen>
      <Top onBack={() => setStep('category')}><Dots current={3} total={7} /></Top>
      <Body>
        <Question>What language do you write to clients?</Question>
        <OptionCard selected={language === 'amharic'} onClick={() => setLanguage('amharic')}>
          <Emoji>🇪🇹</Emoji>
          <CardTitle>Amharic</CardTitle>
          <CardSub amh>ብቻ</CardSub>
        </OptionCard>
        <OptionCard selected={language === 'mixed'} onClick={() => setLanguage('mixed')}>
          <Emoji>🌍</Emoji>
          <CardTitle>Both mixed</CardTitle>
          <CardSub>Amharic + English</CardSub>
        </OptionCard>
        <OptionCard selected={language === 'english'} onClick={() => setLanguage('english')}>
          <Emoji>🇬🇧</Emoji>
          <CardTitle>English only</CardTitle>
        </OptionCard>
      </Body>
      <BottomBar>
        <PrimaryBtn disabled={!language} onClick={() => setStep('tone')}>Continue →</PrimaryBtn>
      </BottomBar>
    </FullScreen>
  );

  // ───────── Step 4 — Tone ─────────
  if (step === 'tone') return (
    <FullScreen>
      <Top onBack={() => setStep('language')}><Dots current={4} total={7} /></Top>
      <Body>
        <Question>How do you talk to clients?</Question>
        <OptionCard selected={tone === 'warm'} onClick={() => setTone('warm')}>
          <CardTitleRow>😊 Warm & friendly</CardTitleRow>
          <CardExample amh>"ሰላም! ደስ ይላል 🙏"</CardExample>
        </OptionCard>
        <OptionCard selected={tone === 'direct'} onClick={() => setTone('direct')}>
          <CardTitleRow>⚡ Short & direct</CardTitleRow>
          <CardExample>"Done by Thursday."</CardExample>
        </OptionCard>
        <OptionCard selected={tone === 'professional'} onClick={() => setTone('professional')}>
          <CardTitleRow>🤝 Professional</CardTitleRow>
          <CardExample>"Dear client, pleased to assist…"</CardExample>
        </OptionCard>
      </Body>
      <BottomBar>
        <PrimaryBtn disabled={!tone} onClick={() => setStep('hours')}>Continue →</PrimaryBtn>
      </BottomBar>
    </FullScreen>
  );

  // ───────── Step 5 — Hours ─────────
  if (step === 'hours') return (
    <FullScreen>
      <Top onBack={() => setStep('tone')}><Dots current={5} total={7} /></Top>
      <Body>
        <Question>When do you work?</Question>
        <Hint>MiniMe won't auto-send outside these hours</Hint>
        <OptionCard selected={hours === '8-20'} onClick={() => setHours('8-20')}>
          <CardTitleRow>8am – 8pm <Pill>most popular</Pill></CardTitleRow>
        </OptionCard>
        <OptionCard selected={hours === '8-18'} onClick={() => setHours('8-18')}>
          <CardTitleRow>8am – 6pm</CardTitleRow>
        </OptionCard>
        <OptionCard selected={hours === '9-17'} onClick={() => setHours('9-17')}>
          <CardTitleRow>9am – 5pm</CardTitleRow>
        </OptionCard>
        <OptionCard selected={hours === '0-24'} onClick={() => setHours('0-24')}>
          <CardTitleRow>24/7 — always on</CardTitleRow>
        </OptionCard>
      </Body>
      <BottomBar>
        <PrimaryBtn disabled={!hours} onClick={() => setStep('voice')}>Continue →</PrimaryBtn>
      </BottomBar>
    </FullScreen>
  );

  // ───────── Step 6 — Voice sample ─────────
  if (step === 'voice') return (
    <FullScreen>
      <Top onBack={() => setStep('hours')}><Dots current={6} total={7} /></Top>
      <Body>
        <Question>Paste a message you sent a client recently</Question>
        <div style={{ background: COLORS.amberLight, borderRadius: RADII.md, padding: 14, marginTop: 12, fontSize: 14, color: '#92400E', lineHeight: 1.5 }}>
          ⭐ Most important step. MiniMe copies your exact writing style from your own words.
        </div>
        <textarea
          value={sample} onChange={e => setSample(e.target.value)}
          placeholder={language === 'amharic' ? 'ሰላም! ፕሮጀክቱ ሐሙስ ዝግጁ ይሆናል…' : 'Hi! Your order is ready for pickup…'}
          rows={5}
          style={{ ...textInput(), fontFamily: language === 'amharic' || language === 'mixed' ? FONT.amharic : FONT.body, marginTop: 16, resize: 'none' }}
        />
        <p style={{ fontSize: 13, color: COLORS.textHint, marginTop: 10, lineHeight: 1.5 }}>
          Don't have one handy? Tap skip — MiniMe will still work but may need a few corrections at first.
        </p>
      </Body>
      <BottomBar>
        <div style={{ display: 'flex', gap: 10 }}>
          <SecondaryBtn onClick={() => setStep('teach')} disabled={busy}>Skip</SecondaryBtn>
          <PrimaryBtn disabled={busy || !sample.trim()} onClick={async () => {
            setBusy(true); setErr('');
            try {
              await fetch('/api/teach', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
                body: JSON.stringify({ description: `Voice sample from owner: "${sample.trim()}". Tone: ${tone}. Language: ${language}. Hours: ${hours}. Category: ${category}.` }),
              }).catch(() => {});
              setStep('teach');
            } catch (e) { setErr(e.message); } finally { setBusy(false); }
          }}>
            {busy ? 'Saving…' : 'Save & continue →'}
          </PrimaryBtn>
        </div>
        {err && <ErrText>{err}</ErrText>}
      </BottomBar>
    </FullScreen>
  );

  // ───────── Step 7 — Quick teach ─────────
  if (step === 'teach') return (
    <FullScreen>
      <Top onBack={() => setStep('voice')}><Dots current={7} total={7} /></Top>
      <Body>
        <Question>Add your first product or FAQ</Question>
        <Hint>MiniMe will know exactly what to say when clients ask</Hint>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {teachItems.map((item, idx) => (
            <div key={idx} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 14, boxShadow: SHADOW.card }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginBottom: 6 }}>QUESTION / PRODUCT NAME</div>
              <input
                value={item.q}
                onChange={e => { const n = [...teachItems]; n[idx] = { ...n[idx], q: e.target.value }; setTeachItems(n); }}
                placeholder={
                  category === 'electronics' ? 'e.g. iPhone 15 price' :
                  category === 'clothing'    ? 'e.g. Size chart for women' :
                  category === 'food'        ? 'e.g. Today\'s special' :
                  'e.g. What are your prices?'
                }
                style={{ width: '100%', border: `1px solid ${COLORS.border}`, borderRadius: RADII.sm, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', background: COLORS.bg, boxSizing: 'border-box' }}
              />
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginTop: 10, marginBottom: 6 }}>YOUR ANSWER</div>
              <textarea
                value={item.a}
                onChange={e => { const n = [...teachItems]; n[idx] = { ...n[idx], a: e.target.value }; setTeachItems(n); }}
                placeholder={
                  category === 'electronics' ? 'iPhone 15 128GB — 135,000 ብር. 256GB — 155,000 ብር.' :
                  category === 'clothing'    ? 'S=36-38cm, M=38-40cm, L=40-42cm — free delivery Addis.' :
                  category === 'food'        ? 'Today: Tibs + injera 180 ብር. Delivery from 11am–9pm.' :
                  'Write what MiniMe should say…'
                }
                rows={3}
                style={{ width: '100%', border: `1px solid ${COLORS.border}`, borderRadius: RADII.sm, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', background: COLORS.bg, resize: 'none', boxSizing: 'border-box' }}
              />
            </div>
          ))}
          {teachItems.length < 3 && (
            <button onClick={() => setTeachItems([...teachItems, { q: '', a: '' }])} style={{
              appearance: 'none', border: `1px dashed ${COLORS.border}`, background: 'transparent',
              borderRadius: RADII.lg, padding: '12px', fontSize: 14, color: COLORS.teal,
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
            }}>+ Add another</button>
          )}
        </div>

        <p style={{ fontSize: 13, color: COLORS.textHint, marginTop: 12, lineHeight: 1.5 }}>
          You can always add more from the Agent → Knowledge tab later.
        </p>
      </Body>
      <BottomBar>
        <div style={{ display: 'flex', gap: 10 }}>
          <SecondaryBtn onClick={() => finish({ skipTeach: true })} disabled={busy}>Skip for now</SecondaryBtn>
          <PrimaryBtn disabled={busy} onClick={() => finish({ skipTeach: false })}>
            {busy ? 'Finishing…' : 'Finish setup →'}
          </PrimaryBtn>
        </div>
        {err && <ErrText>{err}</ErrText>}
      </BottomBar>
    </FullScreen>
  );

  // ───────── Done ─────────
  if (step === 'done') return (
    <FullScreen>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 24px', textAlign: 'center' }}>
        <div style={{
          width: 88, height: 88, borderRadius: 26, marginBottom: 24,
          background: `linear-gradient(135deg, ${COLORS.teal} 0%, #0F766E 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 16px 48px rgba(13,148,136,0.35)`,
          fontSize: 44, animation: 'mmBounce 0.6s cubic-bezier(0.34,1.56,0.64,1)',
        }}>✅</div>
        <h2 style={{
          fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400,
          fontSize: 30, color: COLORS.textPrimary, margin: 0, letterSpacing: '-0.025em',
        }}>You're all set!</h2>
        <p style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12, lineHeight: 1.5, maxWidth: 300 }}>
          MiniMe knows your voice. Link your Telegram bot and your first AI reply is ready.
        </p>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, marginTop: 28, width: '100%', maxWidth: 360, boxShadow: SHADOW.card, textAlign: 'left' }}>
          <SummaryRow label="Business" value={name} />
          <SummaryRow label="Category" value={CATEGORIES.find(c => c.id === category)?.label || '—'} />
          <SummaryRow label="Language" value={language === 'amharic' ? 'Amharic only' : language === 'mixed' ? 'Amharic + English' : 'English only'} />
          <SummaryRow label="Tone" value={tone === 'warm' ? 'Warm & friendly' : tone === 'direct' ? 'Short & direct' : 'Professional'} />
          <SummaryRow label="Hours" value={hours === '0-24' ? '24/7' : hours === '8-20' ? '8am–8pm' : hours === '8-18' ? '8am–6pm' : '9am–5pm'} last />
        </div>
        {linkedBot && (
          <div style={{ marginTop: 14, fontSize: 13, color: COLORS.textHint }}>
            Bot: <b>@{linkedBot.username}</b>
          </div>
        )}
      </div>
      <BottomBar>
        <PrimaryBtn onClick={() => router.push('/')}>Open my dashboard →</PrimaryBtn>
      </BottomBar>
      <style>{`
        @keyframes mmBounce{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
      `}</style>
    </FullScreen>
  );

  // ─── finish helper ─────────
  async function finish({ skipTeach }) {
    setBusy(true); setErr('');
    try {
      // Save teach items
      if (!skipTeach) {
        const validItems = teachItems.filter(it => it.q.trim() && it.a.trim());
        for (const it of validItems) {
          await fetch('/api/agent/knowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
            body: JSON.stringify({ title: it.q.trim(), body: it.a.trim(), source: 'onboarding' }),
          }).catch(() => {});
        }
      }
      // Save quiet hours
      if (hours && hours !== '0-24') {
        const [s, e] = hours.split('-').map(Number);
        await fetch('/api/settings/hours', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ enabled: true, start_hour: e, end_hour: s, mode: 'auto_reply', message: "We're closed right now — I've got your message and we'll reply during business hours." }),
        }).catch(() => {});
      }
      setStep('done');
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }
}

// ────────────────────────── primitives ──────────────────────────
function FullScreen({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, display: 'flex', flexDirection: 'column', fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {children}
    </div>
  );
}
function Top({ children, onBack }) {
  return (
    <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      {onBack && (
        <button onClick={onBack} style={{
          position: 'absolute', left: 20, appearance: 'none', border: 'none',
          background: 'transparent', color: COLORS.textHint, cursor: 'pointer',
          fontSize: 22, lineHeight: 1, padding: '2px 4px', fontFamily: 'inherit',
        }}>‹</button>
      )}
      {children}
    </div>
  );
}
function Body({ children }) { return <div style={{ flex: 1, padding: '28px 20px 20px', overflowY: 'auto' }}>{children}</div>; }
function BottomBar({ children }) {
  return (
    <div style={{ padding: '16px 20px', paddingBottom: 'max(16px, env(safe-area-inset-bottom))', background: COLORS.bg, borderTop: `1px solid ${COLORS.border}` }}>
      {children}
    </div>
  );
}
function Question({ children }) {
  return (
    <h2 style={{
      fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400,
      fontSize: 26, color: COLORS.textPrimary, margin: 0, lineHeight: 1.25,
      letterSpacing: '-0.02em',
    }}>{children}</h2>
  );
}
function Hint({ children }) { return <p style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 8, lineHeight: 1.5 }}>{children}</p>; }
function ErrText({ children }) { return <p style={{ fontSize: 13, color: COLORS.red, marginTop: 8 }}>{children}</p>; }
function Dots({ current, total }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i < current ? COLORS.teal : COLORS.border }} />
      ))}
    </div>
  );
}
function PrimaryBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', appearance: 'none', border: 'none',
      background: disabled ? '#A7D9D5' : COLORS.teal, color: '#FFFFFF',
      padding: '16px', borderRadius: RADII.md, fontSize: 16, fontWeight: 600,
      cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
      transition: 'transform 100ms ease',
    }}
    onPointerDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.97)')}
    onPointerUp={e => (e.currentTarget.style.transform = 'scale(1)')}
    onPointerLeave={e => (e.currentTarget.style.transform = 'scale(1)')}>
      {children}
    </button>
  );
}
function SecondaryBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, appearance: 'none', border: `1px solid ${COLORS.border}`,
      background: COLORS.surface, color: COLORS.textPrimary,
      padding: '16px', borderRadius: RADII.md, fontSize: 16, fontWeight: 500,
      cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
    }}>{children}</button>
  );
}
function OptionCard({ children, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', appearance: 'none', textAlign: 'left',
      border: `2px solid ${selected ? COLORS.teal : COLORS.border}`,
      background: selected ? COLORS.tealLight : COLORS.surface,
      borderRadius: RADII.lg, padding: '16px', marginTop: 12,
      fontFamily: 'inherit', cursor: 'pointer',
      boxShadow: SHADOW.card, transition: 'all 150ms ease',
    }}>{children}</button>
  );
}
function Emoji({ children }) { return <div style={{ fontSize: 28, marginBottom: 8 }}>{children}</div>; }
function CardTitle({ children }) { return <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary }}>{children}</div>; }
function CardTitleRow({ children }) { return <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>{children}</div>; }
function CardSub({ children, amh }) { return <div style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 2, fontFamily: amh ? FONT.amharic : 'inherit' }}>{children}</div>; }
function CardExample({ children, amh }) { return <div style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 6, fontStyle: 'italic', fontFamily: amh ? FONT.amharic : 'inherit' }}>{children}</div>; }
function Pill({ children }) { return <span style={{ fontSize: 11, padding: '2px 8px', background: COLORS.tealLight, color: COLORS.teal, borderRadius: 999, fontWeight: 500 }}>{children}</span>; }
function SummaryRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: last ? 'none' : `1px solid ${COLORS.divider}` }}>
      <span style={{ fontSize: 13, color: COLORS.textSecondary }}>{label}</span>
      <span style={{ fontSize: 14, color: COLORS.textPrimary, fontWeight: 500 }}>{value}</span>
    </div>
  );
}
function textInput() {
  return {
    width: '100%', appearance: 'none',
    border: `2px solid ${COLORS.border}`, background: COLORS.surface,
    borderRadius: RADII.md, padding: 16, fontSize: 18, color: COLORS.textPrimary,
    fontFamily: 'inherit', outline: 'none', marginTop: 20,
    transition: 'border-color 150ms ease', boxSizing: 'border-box',
  };
}
