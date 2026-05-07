'use client';
/**
 * MiniMe — A Tale of Two Tuesdays
 * Animated onboarding/demo narrative from the Claude Design handoff.
 *
 * Phase flow: act1 → interlude → act2 → act3
 * Each phase is timer-driven and auto-advances through its event array.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// ─── Design tokens (light + dark, from MiniMe handoff) ────────────────────────
const T = {
  bg: '#FBF6EC',      // parchment
  bg2: '#F3EBDA',     // warm cream
  paper: '#FFFFFF',
  ink: '#1A0F08',     // espresso black
  ink2: '#3D2817',    // dark roast
  muted: '#6B5947',
  line: 'rgba(26,15,8,0.10)',
  line2: 'rgba(26,15,8,0.18)',
  primary: '#8B2E1F',   // crimson berry
  primaryDeep: '#6B1F12',
  accent: '#D9A441',    // brass
  success: '#3F5D3F',
  chip: '#EFE5D0',
};

// Dark (Act I)
const DK = {
  bg: '#0E0907',
  bg2: '#F5ECDC',   // text on dark
  ink: '#F5ECDC',
  muted: 'rgba(245,236,220,.55)',
  line: 'rgba(245,236,220,.08)',
  danger: '#E0654E',
  accent: '#D9A441',
};

const SERIF = "'Fraunces', 'Georgia', serif";
const AMH   = "'Noto Serif Ethiopic', 'Georgia', serif";
const MONO  = "'JetBrains Mono', 'Consolas', monospace";

// ─── Act data ─────────────────────────────────────────────────────────────────
const ACT1 = [
  { id: 1,  type: 'caption',     text: 'Tuesday · 7:42 AM · Selam is opening the shop alone.',           delay: 2200 },
  { id: 2,  type: 'cust',        who: 'Almaz Z.',  text: 'ሰላም! ቀሚሱን አሁንም አለ?',                        delay: 1500 },
  { id: 3,  type: 'unread',                                                                              delay:  900 },
  { id: 4,  type: 'caption',     text: '9:14 AM · Customer in the shop. Phone in pocket.',                delay: 1900 },
  { id: 5,  type: 'cust',        who: 'Daniel B.', text: 'Is the navy linen suit in 42R?',               delay: 1300 },
  { id: 6,  type: 'cust',        who: 'Hanna T.',  text: 'ወደ ቦሌ መላክ ትችላላችሁ?',                        delay: 1100 },
  { id: 7,  type: 'unreadStack', count: 3,                                                               delay:  900 },
  { id: 8,  type: 'caption',     text: '12:30 PM · Lunch. Selam tries to type back.',                    delay: 2000 },
  { id: 9,  type: 'selamDraft',  text: 'ሰላም! አዎ … sorry just one sec',                                  delay: 1700 },
  { id: 10, type: 'unread',                                                                              delay: 1000 },
  { id: 11, type: 'caption',     text: '3:48 PM · Almaz bought it from the shop next door.',             delay: 2400 },
  { id: 12, type: 'lostSale',    amount: '1,800',                                                        delay: 1500 },
  { id: 13, type: 'caption',     text: '10:21 PM · After dinner, after the kids. The phone glows.',      delay: 2200 },
  { id: 14, type: 'cust',        who: 'Mike R.',   text: 'do u accept telebirr?',                        delay: 1100 },
  { id: 15, type: 'selamReply',  text: 'Yes! sorry for late',                                            delay: 1500 },
  { id: 16, type: 'caption',     text: 'Bedtime: midnight. Sleep: not yet. Tomorrow: same.',             delay: 2400 },
];

const ACT2 = [
  { id: 1,  type: 'caption', text: 'Tuesday · 7:42 AM · Selam is opening the shop. Again.', delay: 1800 },
  { id: 2,  type: 'cust2',   who: 'Almaz Z.', text: 'ሰላም! ቀሚሱን አሁንም አለ?',   en: '"Selam! Is the dress still in stock?"', delay: 1300 },
  { id: 3,  type: 'typing',                                                                              delay: 1000 },
  { id: 4,  type: 'bot',     text: 'ሰላም አልማዝ! አዎ — ቀይ ሐር ቀሚስ M ሳይዝ አሁንም አለ ☕ 1,800 ብር።', en: '"Hi Almaz! Yes — red silk dress, M, still here ☕ 1,800 birr."', conf: 96, delay: 1100 },
  { id: 5,  type: 'cust2',   who: 'Almaz Z.', text: 'ጥሩ! ወደ ቦሌ ማድረስ ይቻላል?', en: '"Great! Deliver to Bole?"', delay: 1200 },
  { id: 6,  type: 'typing',                                                                              delay:  900 },
  { id: 7,  type: 'bot',     text: 'አዎ ቦሌ — 150 ብር, ዛሬ ከ3 ሰዓት በፊት ካዘዙ።', en: '"Yes Bole — 150 ETB, today if ordered before 3pm."', conf: 94, delay: 1100 },
  { id: 8,  type: 'cust2',   who: 'Almaz Z.', text: 'እሺ ላዘዘው። በቴሌብር ነው ክፍያ።', en: '"OK ordering. Pay with Telebirr."', delay: 1100 },
  { id: 9,  type: 'typing',                                                                              delay:  800 },
  { id: 10, type: 'bot',     text: 'በጣም ጥሩ! ይኸ ማረጋገጫ ነው 🌷', en: '"Wonderful! Here\'s your order 🌷"', conf: 98, delay:  700 },
  { id: 11, type: 'order',                                                                               delay: 1400 },
  { id: 12, type: 'cust2',   who: 'Almaz Z.', text: 'አመሰግናለሁ! 💛', en: '"Thank you so much! 💛"', delay: 1200 },
  { id: 13, type: 'sysClose', text: 'Order #4827 · 1,950 ETB · closed in 3m 14s · Selam: not interrupted.', delay: 2000 },
];

// ─── Atom components ──────────────────────────────────────────────────────────

function Caption({ text, light }) {
  const lineColor = light ? T.line : 'rgba(245,236,220,.3)';
  const textColor = light ? T.ink2 : 'rgba(245,236,220,.85)';
  return (
    <div style={{ alignSelf: 'center', textAlign: 'center', maxWidth: 520, padding: '18px 24px', animation: 'mmFadeInBlur .9s ease-out both' }}>
      <div style={{ height: 1, width: 60, background: lineColor, margin: '0 auto 14px' }} />
      <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 17, lineHeight: 1.5, color: textColor, letterSpacing: '.005em' }}>{text}</div>
      <div style={{ height: 1, width: 60, background: lineColor, margin: '14px auto 0' }} />
    </div>
  );
}

function Cust({ who, text }) {
  return (
    <div style={{ animation: 'mmSlideUpL .55s cubic-bezier(.2,.8,.2,1) both', maxWidth: '74%', alignSelf: 'flex-start' }}>
      <div style={{ fontSize: 11, color: DK.muted, marginBottom: 6, fontWeight: 500 }}>{who}</div>
      <div style={{ padding: '13px 17px', background: 'rgba(245,236,220,.06)', color: DK.ink, border: '1px solid rgba(245,236,220,.1)', borderRadius: '4px 18px 18px 18px', fontFamily: AMH, fontSize: 16, lineHeight: 1.45 }}>{text}</div>
    </div>
  );
}

function Cust2({ who, text, en }) {
  return (
    <div style={{ animation: 'mmSlideUpL .55s cubic-bezier(.2,.8,.2,1) both', maxWidth: '76%', alignSelf: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: T.primary, color: '#FFF', fontFamily: SERIF, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>AZ</div>
        <span style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{who}</span>
      </div>
      <div style={{ padding: '13px 17px', background: '#FFF', border: `1px solid ${T.line}`, borderRadius: '4px 18px 18px 18px', fontFamily: AMH, fontSize: 16, lineHeight: 1.45, color: T.ink, boxShadow: '0 1px 2px rgba(26,15,8,.04)' }}>{text}</div>
      <div style={{ marginTop: 5, fontSize: 11, color: T.muted, fontStyle: 'italic', fontFamily: SERIF }}>{en}</div>
    </div>
  );
}

function Bot({ text, en, conf }) {
  return (
    <div style={{ animation: 'mmSlideUpL .6s cubic-bezier(.2,.8,.2,1) both', maxWidth: '76%', alignSelf: 'flex-end' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 999, background: T.success + '1A', color: T.success, fontFamily: MONO, letterSpacing: '.04em', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.success }} />{conf}% match
        </span>
        <span style={{ fontSize: 11, color: T.primary, fontFamily: SERIF, fontStyle: 'italic' }}>MiniMe</span>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: T.primary, color: '#FFF', fontFamily: SERIF, fontSize: 11, fontStyle: 'italic', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>m</div>
      </div>
      <div style={{ padding: '13px 17px', background: T.primary, color: '#FFF', borderRadius: '18px 4px 18px 18px', fontFamily: AMH, fontSize: 16, lineHeight: 1.45, boxShadow: '0 1px 3px rgba(139,46,31,.25), 0 8px 24px rgba(139,46,31,.12)' }}>{text}</div>
      <div style={{ marginTop: 5, fontSize: 11, color: T.muted, fontStyle: 'italic', fontFamily: SERIF, textAlign: 'right' }}>{en}</div>
    </div>
  );
}

function TypingB() {
  return (
    <div style={{ animation: 'mmFadeIn .35s ease-out both', alignSelf: 'flex-end' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 10, color: T.primary, fontStyle: 'italic', fontFamily: SERIF }}>composing in your voice</span>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: T.primary, color: '#FFF', fontFamily: SERIF, fontSize: 11, fontStyle: 'italic', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>m</div>
      </div>
      <div style={{ padding: '14px 18px', background: T.chip, border: `1px dashed ${T.primary}`, borderRadius: '18px 4px 18px 18px', display: 'inline-flex' }}>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: T.primary, animation: `mmTypingDot 1.2s ${i * .15}s infinite ease-in-out` }} />
          ))}
        </span>
      </div>
    </div>
  );
}

function Unread({ stack = 1 }) {
  return (
    <div style={{ animation: 'mmSlideUp .45s ease-out both', alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 10 }}>
      {Array.from({ length: stack }).map((_, i) => (
        <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: DK.danger, boxShadow: '0 0 0 4px rgba(224,101,78,.15)', animation: `mmFlicker 1.6s ${i * .2}s infinite` }} />
      ))}
      <span style={{ fontSize: 11, color: DK.danger, fontFamily: MONO, letterSpacing: '.1em' }}>{stack > 1 ? `${stack} UNREAD` : 'UNREAD'}</span>
    </div>
  );
}

function SelamDraft({ text }) {
  return (
    <div style={{ animation: 'mmSlideUpL .5s ease-out both', maxWidth: '70%', alignSelf: 'flex-end' }}>
      <div style={{ fontSize: 11, color: 'rgba(245,236,220,.5)', textAlign: 'right', marginBottom: 6, fontStyle: 'italic', fontFamily: SERIF }}>Selam · drafting…</div>
      <div style={{ padding: '13px 17px', background: 'rgba(245,236,220,.04)', border: '1px dashed rgba(245,236,220,.25)', borderRadius: '18px 4px 18px 18px', fontFamily: AMH, fontSize: 15, color: 'rgba(245,236,220,.5)', fontStyle: 'italic', lineHeight: 1.45 }}>
        {text}<span style={{ color: DK.danger, marginLeft: 2, animation: 'mmFlicker 1s steps(2) infinite' }}>|</span>
      </div>
    </div>
  );
}

function SelamReply({ text }) {
  return (
    <div style={{ animation: 'mmSlideUpL .5s ease-out both', maxWidth: '70%', alignSelf: 'flex-end' }}>
      <div style={{ fontSize: 11, color: 'rgba(245,236,220,.45)', textAlign: 'right', marginBottom: 6 }}>Selam · 22:34, 14h late</div>
      <div style={{ padding: '13px 17px', background: 'rgba(224,101,78,.18)', borderRadius: '18px 4px 18px 18px', fontSize: 15, color: DK.bg2 }}>{text}</div>
    </div>
  );
}

function LostSale({ amount }) {
  return (
    <div style={{ animation: 'mmRiseIn .9s cubic-bezier(.2,.8,.2,1) both', alignSelf: 'center', textAlign: 'center', padding: '22px 28px', border: '1px solid rgba(224,101,78,.3)', borderRadius: 6, background: 'rgba(224,101,78,.08)' }}>
      <div style={{ fontSize: 10, letterSpacing: '.22em', color: DK.danger, textTransform: 'uppercase', marginBottom: 8 }}>Lost sale · ኪሳራ</div>
      <div style={{ fontFamily: SERIF, fontSize: 42, fontWeight: 300, color: DK.danger, letterSpacing: '-.03em', lineHeight: 1 }}>
        −{amount}<span style={{ fontSize: 18, marginLeft: 6, opacity: .6 }}>ETB</span>
      </div>
      <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(245,236,220,.6)', marginTop: 8, maxWidth: 280 }}>
        Bought next door. Almaz won't be back this month.
      </div>
    </div>
  );
}

function OrderCard() {
  return (
    <div style={{ animation: 'mmRiseIn .9s cubic-bezier(.2,.8,.2,1) both', alignSelf: 'flex-end', width: '88%' }}>
      <div style={{ background: '#1A0F08', color: T.bg, borderRadius: 14, padding: '20px 22px', boxShadow: '0 4px 16px rgba(26,15,8,.18), 0 24px 60px rgba(26,15,8,.18)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${T.accent}, transparent)`, animation: 'mmSweep 2.4s ease-in-out infinite' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <span style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: T.accent, fontWeight: 500 }}>Order confirmed · #4827</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'rgba(245,236,220,.5)' }}>14:22</span>
        </div>
        <div style={{ display: 'flex', gap: 14, paddingBottom: 14, borderBottom: '1px solid rgba(245,236,220,.1)' }}>
          <div style={{ width: 56, height: 56, borderRadius: 6, background: 'linear-gradient(135deg,#8B2E1F,#D9A441)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>👗</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: SERIF, fontSize: 17, fontStyle: 'italic', letterSpacing: '-.01em' }}>Red silk dress · M</div>
            <div style={{ fontSize: 11, color: 'rgba(245,236,220,.55)', marginTop: 3, fontFamily: MONO }}>SLM-D24-RED-M · ×1</div>
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 20, color: T.accent, fontWeight: 300 }}>1,800</div>
        </div>
        <div style={{ paddingTop: 13, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
          <div>
            <div style={{ color: 'rgba(245,236,220,.45)', fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase' }}>Delivery</div>
            <div style={{ marginTop: 3, fontFamily: SERIF, fontStyle: 'italic' }}>Bole · today, 6pm</div>
          </div>
          <div>
            <div style={{ color: 'rgba(245,236,220,.45)', fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase' }}>Pay</div>
            <div style={{ marginTop: 3, fontFamily: SERIF, fontStyle: 'italic' }}>Telebirr · 1,950 ETB</div>
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button style={{ flex: 1, border: 'none', background: T.accent, color: T.ink, padding: 10, borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', animation: 'mmGlow 2.2s ease-in-out infinite', fontFamily: 'inherit' }}>Pay with Telebirr →</button>
          <button style={{ border: '1px solid rgba(245,236,220,.25)', background: 'transparent', color: T.bg, padding: '10px 14px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Track</button>
        </div>
      </div>
    </div>
  );
}

function SysClose({ text }) {
  return (
    <div style={{ animation: 'mmFadeIn .6s ease-out both', alignSelf: 'center', textAlign: 'center', padding: '10px 16px', borderRadius: 999, background: T.success + '18', color: T.success, fontSize: 11, fontFamily: SERIF, fontStyle: 'italic' }}>
      ✓ {text}
    </div>
  );
}

// ─── CountUp animated number ──────────────────────────────────────────────────
function CountUp({ to, decimals = 0, suffix = '', duration = 1600, delay = 0 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf, start;
    const t = setTimeout(() => {
      const tick = ts => {
        if (!start) start = ts;
        const p = Math.min((ts - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setV(to * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); };
  }, [to, duration, delay]);
  return <span>{v.toFixed(decimals)}{suffix}</span>;
}

// ─── Act I: Without MiniMe ────────────────────────────────────────────────────
function ActOne({ idx, isMobile }) {
  const scrollRef = useRef(null);
  const stress = Math.min(idx / ACT1.length, 1);
  const lostMins = Math.min(idx * 12, 142);
  const visible = ACT1.slice(0, idx);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [idx]);

  const slippingItems = [
    { i: 4,  label: 'Almaz · stock check', cost: 'replied 8h late' },
    { i: 6,  label: 'Daniel · suit size',  cost: 'no reply' },
    { i: 7,  label: 'Hanna · delivery',    cost: 'no reply' },
    { i: 12, label: 'Sale to Almaz',       cost: 'lost — 1,800 ETB' },
    { i: 14, label: 'Mike · Telebirr',     cost: 'replied at 22:34' },
  ];

  return (
    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(180deg,#0E0907 0%,#1A0F08 100%)', display: isMobile ? 'block' : 'grid', gridTemplateColumns: '1fr 280px', position: 'relative', overflow: isMobile ? 'auto' : 'hidden' }}>
      {/* Chat column */}
      <div
        ref={scrollRef}
        style={{
          overflow: isMobile ? 'visible' : 'auto',
          padding: isMobile ? '32px 20px 32px' : '48px 64px 40px',
          display: 'flex', flexDirection: 'column', gap: 18,
          animation: stress > 0.4 ? 'mmStress 1.6s ease-in-out infinite' : 'none',
        }}
      >
        <div style={{ animation: 'mmFadeIn .8s ease-out both', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'rgba(245,236,220,.45)', letterSpacing: '.25em' }}>ACT I</div>
          <h2 style={{ fontFamily: SERIF, fontSize: isMobile ? 34 : 46, fontWeight: 300, fontStyle: 'italic', letterSpacing: '-.025em', color: DK.bg2, margin: '10px 0 4px' }}>
            Without <span style={{ color: DK.danger }}>MiniMe</span>.
          </h2>
          <div style={{ fontFamily: AMH, fontSize: 18, color: 'rgba(245,236,220,.55)' }}>ያለ ሚኒሚ ቀን።</div>
        </div>

        {visible.map(s => {
          if (s.type === 'caption')     return <Caption key={s.id} text={s.text} />;
          if (s.type === 'cust')        return <Cust key={s.id} who={s.who} text={s.text} />;
          if (s.type === 'unread')      return <Unread key={s.id} />;
          if (s.type === 'unreadStack') return <Unread key={s.id} stack={s.count} />;
          if (s.type === 'selamDraft')  return <SelamDraft key={s.id} text={s.text} />;
          if (s.type === 'selamReply')  return <SelamReply key={s.id} text={s.text} />;
          if (s.type === 'lostSale')    return <LostSale key={s.id} amount={s.amount} />;
          return null;
        })}
      </div>

      {/* Right rail (desktop only) */}
      {!isMobile && (
        <div style={{ background: 'rgba(245,236,220,.02)', borderLeft: '1px solid rgba(245,236,220,.08)', padding: '48px 24px', display: 'flex', flexDirection: 'column', gap: 24, overflow: 'auto' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'rgba(245,236,220,.5)', marginBottom: 10 }}>Stress level</div>
            <div style={{ height: 6, background: 'rgba(245,236,220,.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${stress * 100}%`, background: 'linear-gradient(90deg,#D9A441,#E0654E,#B23A1F)', transition: 'width .8s cubic-bezier(.2,.8,.2,1)' }} />
            </div>
            <div style={{ marginTop: 8, fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: stress > .6 ? DK.danger : 'rgba(245,236,220,.7)', transition: 'color .6s' }}>
              {stress < .25 ? 'Coffee. New day.' : stress < .5 ? 'Phone buzzing. Customer waiting.' : stress < .8 ? 'Five threads. One brain.' : 'Burnt out by 11pm.'}
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(245,236,220,.08)' }} />

          <div>
            <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'rgba(245,236,220,.5)', marginBottom: 8 }}>Hustle counter</div>
            <div style={{ fontFamily: SERIF, fontSize: 56, fontWeight: 300, color: DK.danger, lineHeight: .9, letterSpacing: '-.03em' }}>
              {Math.floor(lostMins)}<span style={{ fontSize: 20, color: 'rgba(245,236,220,.6)', fontStyle: 'italic', marginLeft: 4 }}>min</span>
            </div>
            <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12, color: 'rgba(245,236,220,.55)', marginTop: 6 }}>spent on Telegram today</div>
          </div>

          <div style={{ height: 1, background: 'rgba(245,236,220,.08)' }} />

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'rgba(245,236,220,.5)', marginBottom: 14 }}>What's slipping</div>
            {slippingItems.map((x, j) => {
              const active = idx >= x.i;
              return (
                <div key={j} style={{ padding: '10px 0', borderBottom: '1px solid rgba(245,236,220,.06)', opacity: active ? 1 : 0.2, transition: 'opacity .8s' }}>
                  <span style={{ fontSize: 12, color: active ? DK.bg2 : 'rgba(245,236,220,.4)', fontFamily: SERIF, fontStyle: 'italic' }}>{x.label}</span>
                  <div style={{ fontSize: 10, fontFamily: MONO, color: active ? DK.danger : 'rgba(245,236,220,.3)', letterSpacing: '.05em', marginTop: 2 }}>{x.cost}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Interlude ────────────────────────────────────────────────────────────────
function Interlude() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#0E0907', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', padding: '0 24px' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 50%, ${T.accent}22 0%, transparent 60%)`, animation: 'mmDrift 4s ease-in-out infinite' }} />
      <div style={{ position: 'relative', textAlign: 'center', animation: 'mmRiseIn 1.4s cubic-bezier(.2,.8,.2,1) both' }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(245,236,220,.55)', letterSpacing: '.3em', marginBottom: 24 }}>· INTERMISSION ·</div>
        <div style={{ fontFamily: SERIF, fontSize: 'clamp(28px, 8vw, 84px)', fontWeight: 300, fontStyle: 'italic', color: DK.bg2, letterSpacing: '-.04em', lineHeight: 1 }}>What if she had</div>
        <div style={{ fontFamily: SERIF, fontSize: 'clamp(40px, 12vw, 120px)', fontWeight: 300, fontStyle: 'italic', color: T.accent, letterSpacing: '-.05em', lineHeight: 1, marginTop: 12 }}>a small her</div>
        <div style={{ fontFamily: SERIF, fontSize: 'clamp(28px, 8vw, 84px)', fontWeight: 300, fontStyle: 'italic', color: DK.bg2, letterSpacing: '-.04em', lineHeight: 1, marginTop: 12 }}>at the counter?</div>
        <div style={{ fontFamily: AMH, fontSize: 'clamp(16px, 4vw, 24px)', color: 'rgba(245,236,220,.6)', marginTop: 32 }}>ትንሽ-እርሷ ቢኖራትስ?</div>
        <div style={{ marginTop: 44, height: 1, width: 140, background: `linear-gradient(90deg, transparent, ${T.accent}, transparent)`, margin: '44px auto 0' }} />
      </div>
    </div>
  );
}

// ─── Act II: With MiniMe ──────────────────────────────────────────────────────
function ActTwo({ idx, isMobile }) {
  const scrollRef = useRef(null);
  const visible = ACT2.slice(0, idx);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [idx]);

  const thinkingEvents = [
    { i: 2,  t: 'Detected: AM · Returning customer (Almaz, 3 visits)' },
    { i: 3,  t: 'Looking up: red silk dress · stock check' },
    { i: 4,  t: 'Reply drafted · 96% match · auto-sent in 1.2s' },
    { i: 5,  t: 'Customer asked: delivery to Bole?' },
    { i: 6,  t: 'Pulling Playbook · "Bole 150 ETB"' },
    { i: 7,  t: 'Reply drafted · 94% match · auto-sent' },
    { i: 8,  t: 'Intent: ORDER · payment: Telebirr' },
    { i: 9,  t: 'Reserving stock · order #4827' },
    { i: 10, t: 'Confirmation drafted · 98% match' },
    { i: 11, t: 'Order card composed' },
    { i: 12, t: 'Closing · +1 visit · 1,950 ETB lifetime' },
    { i: 13, t: 'Logged · Selam stayed in her shop.' },
  ];
  const live = thinkingEvents.filter(e => e.i <= idx).slice(-6);

  const chatBg = `radial-gradient(circle at 20% 0%, ${T.accent}12 0%, transparent 50%), radial-gradient(circle at 100% 100%, ${T.primary}10 0%, transparent 50%), ${T.bg2}`;

  return (
    <div style={{ width: '100%', height: '100%', display: isMobile ? 'block' : 'grid', gridTemplateColumns: '1fr 320px', background: T.bg2, overflow: isMobile ? 'auto' : 'hidden' }}>
      {/* Chat */}
      <div
        ref={scrollRef}
        style={{
          overflow: isMobile ? 'visible' : 'auto',
          padding: isMobile ? '32px 20px 32px' : '48px 64px 40px',
          display: 'flex', flexDirection: 'column', gap: 16,
          background: chatBg,
        }}
      >
        <div style={{ animation: 'mmFadeIn .8s ease-out both', textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, letterSpacing: '.25em' }}>ACT II</div>
          <h2 style={{ fontFamily: SERIF, fontSize: isMobile ? 34 : 46, fontWeight: 300, fontStyle: 'italic', letterSpacing: '-.025em', color: T.ink, margin: '10px 0 4px' }}>
            With <span style={{ color: T.primary }}>MiniMe</span>.
          </h2>
          <div style={{ fontFamily: AMH, fontSize: 18, color: T.primary }}>ከሚኒሚ ጋር።</div>
        </div>

        {visible.map(s => {
          if (s.type === 'caption') return (
            <div key={s.id} style={{ alignSelf: 'center', textAlign: 'center', maxWidth: 520, padding: '14px 20px', animation: 'mmFadeInBlur .9s ease-out both' }}>
              <div style={{ height: 1, width: 50, background: T.line, margin: '0 auto 10px' }} />
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, lineHeight: 1.5, color: T.ink2 }}>{s.text}</div>
              <div style={{ height: 1, width: 50, background: T.line, margin: '10px auto 0' }} />
            </div>
          );
          if (s.type === 'cust2')    return <Cust2 key={s.id} who={s.who} text={s.text} en={s.en} />;
          if (s.type === 'typing')   return <TypingB key={s.id} />;
          if (s.type === 'bot')      return <Bot key={s.id} text={s.text} en={s.en} conf={s.conf} />;
          if (s.type === 'order')    return <OrderCard key={s.id} />;
          if (s.type === 'sysClose') return <SysClose key={s.id} text={s.text} />;
          return null;
        })}
      </div>

      {/* Live thinking rail (desktop only) */}
      {!isMobile && (
        <div style={{ background: T.ink, color: T.bg, padding: '48px 24px 28px', display: 'flex', flexDirection: 'column', gap: 18, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${T.accent}, transparent)`, animation: 'mmSweep 3s ease-in-out infinite' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.accent, animation: 'mmPulse 1.4s infinite' }} />
            <span style={{ fontSize: 10, letterSpacing: '.25em', textTransform: 'uppercase', color: T.accent }}>Live · MiniMe thinking</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
            {live.map((e, i) => (
              <div key={e.i} style={{ animation: 'mmSlideUp .5s ease-out both', opacity: 1 - (live.length - 1 - i) * .13 }}>
                <div style={{ fontFamily: MONO, fontSize: 9, color: T.accent, letterSpacing: '.1em' }}>STEP {String(e.i).padStart(2, '0')}</div>
                <div style={{ fontFamily: SERIF, fontSize: 13.5, color: T.bg, marginTop: 3, lineHeight: 1.45, fontStyle: 'italic' }}>{e.t}</div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid rgba(245,236,220,.1)', paddingTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[{ l: 'LATENCY', v: '1.2s' }, { l: 'MATCH', v: '96%' }].map((x, i) => (
              <div key={i}>
                <div style={{ fontFamily: MONO, fontSize: 9, color: 'rgba(245,236,220,.45)', letterSpacing: '.1em' }}>{x.l}</div>
                <div style={{ fontFamily: SERIF, fontSize: 22, color: T.bg, marginTop: 2, fontWeight: 300 }}>{x.v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Act III: The Debrief ─────────────────────────────────────────────────────
function ActThree({ isMobile }) {
  const days = [
    { d: 'Mon', am: 'ሰኞ', s: 1.8, r: 18 },
    { d: 'Tue', am: 'ማክ', s: 2.4, r: 24 },
    { d: 'Wed', am: 'ረቡ', s: 1.6, r: 16 },
    { d: 'Thu', am: 'ሐሙ', s: 3.1, r: 31 },
    { d: 'Fri', am: 'ዓር', s: 4.2, r: 42 },
    { d: 'Sat', am: 'ቅዳ', s: 5.0, r: 50 },
    { d: 'Sun', am: 'እሁ', s: 2.7, r: 27 },
  ];
  const max = Math.max(...days.map(d => d.s));

  return (
    <div style={{ width: '100%', height: '100%', background: T.bg, color: T.ink, padding: isMobile ? '28px 20px 60px' : '40px 64px', overflow: 'auto', position: 'relative' }}>
      <div style={{ position: 'absolute', top: -100, left: '40%', width: 600, height: 300, background: `radial-gradient(ellipse, ${T.accent}22 0%, transparent 70%)`, pointerEvents: 'none' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, animation: 'mmFadeIn .6s both' }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.25em', textTransform: 'uppercase', color: T.muted }}>ACT III · the debrief</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>20 — 26 APR · 2026</div>
      </div>

      <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 48, marginTop: 14, alignItems: 'flex-start' }}>
        <div style={{ marginBottom: isMobile ? 32 : 0 }}>
          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 22, color: T.ink2, animation: 'mmFadeInBlur 1s .2s both', lineHeight: 1.4 }}>
            Almaz's order took <em style={{ color: T.primary }}>3m 14s</em>.<br />
            It took Selam <em style={{ color: T.primary }}>nothing</em>.
          </div>

          <div style={{ height: 1, background: T.line, margin: '24px 0', animation: 'mmFadeIn 1s .6s both' }} />

          <div style={{ fontFamily: SERIF, fontSize: isMobile ? 100 : 160, fontWeight: 300, lineHeight: .85, letterSpacing: '-.06em', color: T.primary, animation: 'mmRiseIn 1.4s .9s cubic-bezier(.2,.8,.2,1) both' }}>
            <CountUp to={20.8} decimals={1} duration={1800} delay={1100} /><span style={{ fontSize: isMobile ? 48 : 72, color: T.ink, fontStyle: 'italic' }}>h</span>
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 26, color: T.ink, marginTop: 8, letterSpacing: '-.02em', animation: 'mmFadeIn 1s 1.4s both' }}>given back this week.</div>
          <div style={{ fontFamily: AMH, fontSize: 18, color: T.primary, marginTop: 4, animation: 'mmFadeIn 1s 1.5s both' }}>በዚህ ሳምንት የተቆጠበ ጊዜ።</div>

          <div style={{ marginTop: 18, fontSize: 13, color: T.muted, fontFamily: SERIF, fontStyle: 'italic', maxWidth: 520, lineHeight: 1.55, animation: 'mmFadeIn 1s 1.7s both' }}>
            That's two and a half mornings, or one full night returned. Selam used Saturday's hours to actually be in her shop — with her customers, in person.
          </div>

          <div style={{ marginTop: 24, padding: '18px 22px', background: 'rgba(139,46,31,.05)', border: `1px solid ${T.line}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, animation: 'mmRiseIn 1s 1.9s both' }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>vs. Act I</div>
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 16, color: T.ink, lineHeight: 1.4 }}>
                Saved <em style={{ color: T.primary }}>1,800 ETB</em> in lost sales.<br />
                Slept by <em style={{ color: T.primary }}>10:30</em>, not midnight.
              </div>
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 48, fontWeight: 300, color: T.primary, letterSpacing: '-.03em' }}>
              ×<CountUp to={28} decimals={0} duration={1400} delay={2100} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { k: 'Conversations', am: 'ውይይቶች',  v: 198, sub: '+22% wow' },
            { k: 'Orders placed',  am: 'ትዕዛዞች',   v: 47,  sub: '94,200 ETB · +18%' },
            { k: 'Auto-sent',      am: 'ራስ-ሰር',   v: 156, sub: 'avg match 95%' },
            { k: 'Avg response',   am: 'ፍጥነት',    v: 22,  suffix: 's', sub: 'down from 4 min' },
            { k: 'New customers',  am: 'አዲስ',     v: 12,  sub: 'first contact' },
            { k: 'Satisfaction',   am: 'ደስታ',     v: 4.9, suffix: '/5', decimals: 1, sub: '41 ratings' },
          ].map((s, i) => (
            <div key={i} style={{ padding: '15px 20px', background: T.paper, border: `1px solid ${T.line}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', animation: `mmRiseIn .8s ${.3 + i * .1}s cubic-bezier(.2,.8,.2,1) both` }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: T.muted }}>{s.k}</div>
                <div style={{ fontSize: 11, color: T.muted, fontFamily: SERIF, fontStyle: 'italic', marginTop: 3 }}>{s.sub}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: SERIF, fontSize: 30, color: T.ink, letterSpacing: '-.02em', lineHeight: 1, fontWeight: 300 }}>
                  <CountUp to={s.v} decimals={s.decimals || 0} suffix={s.suffix || ''} delay={500 + i * 120} />
                </span>
                <span style={{ fontFamily: AMH, fontSize: 11, color: T.primary }}>{s.am}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bar chart */}
      <div style={{ marginTop: 32, paddingTop: 24, borderTop: `1px solid ${T.line}`, animation: 'mmFadeIn 1s 1.6s both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div style={{ fontFamily: SERIF, fontSize: 20, fontStyle: 'italic', color: T.ink }}>Hours saved per day</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>peak: SAT · 5.0h · 50 conversations</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 10, alignItems: 'end', height: 150 }}>
          {days.map((d, i) => {
            const h = (d.s / max) * 100;
            const peak = d.s === max;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: peak ? T.primary : T.muted, marginBottom: 5, animation: `mmFadeIn .6s ${1.8 + i * .1}s both` }}>{d.s.toFixed(1)}h</div>
                <div style={{ width: '100%', height: `${h}%`, minHeight: 8, background: peak ? `linear-gradient(180deg,${T.accent},${T.primary})` : T.ink, borderRadius: '4px 4px 0 0', position: 'relative', animation: `mmGrow .9s ${1.6 + i * .1}s cubic-bezier(.2,.8,.2,1) both` }}>
                  <div style={{ position: 'absolute', top: 5, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: '#FFF', opacity: .7, fontFamily: MONO }}>{d.r}</div>
                </div>
                <div style={{ fontFamily: SERIF, fontSize: 12, color: T.ink, marginTop: 7, fontStyle: peak ? 'italic' : 'normal' }}>{d.d}</div>
                <div style={{ fontFamily: AMH, fontSize: 10, color: T.muted, marginTop: 1 }}>{d.am}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA — get started */}
      <div style={{ marginTop: 40, paddingTop: 32, borderTop: `1px solid ${T.line}`, textAlign: 'center', animation: 'mmRiseIn 1s 3s cubic-bezier(.2,.8,.2,1) both' }}>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 22, color: T.ink2, marginBottom: 6 }}>
          Ready to give Selam's Tuesday to yourself?
        </div>
        <div style={{ fontFamily: AMH, fontSize: 14, color: T.primary, marginBottom: 24 }}>
          MiniMe ለሥራዎ ዝግጁ ነው።
        </div>
        <Link href="/onboarding" style={{ textDecoration: 'none' }}>
          <button style={{
            background: T.primary, color: '#FFF', border: 'none',
            padding: isMobile ? '16px 32px' : '18px 48px',
            borderRadius: 999, fontSize: 16, fontWeight: 600,
            cursor: 'pointer', fontFamily: SERIF, fontStyle: 'italic',
            letterSpacing: '-.01em',
            boxShadow: `0 4px 24px ${T.primary}44`,
            transition: 'transform .15s, box-shadow .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 32px ${T.primary}66`; }}
          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 4px 24px ${T.primary}44`; }}
          >
            Set up MiniMe for my business →
          </button>
        </Link>
        <div style={{ marginTop: 12, fontSize: 12, color: T.muted, fontStyle: 'italic', fontFamily: SERIF }}>
          Free to start · takes 2 minutes
        </div>
      </div>
    </div>
  );
}

// ─── Controller ───────────────────────────────────────────────────────────────
function ctrlBtn(phase, primary = false) {
  const dark = phase === 'act1' || phase === 'interlude';
  return {
    border: primary ? 'none' : `1px solid ${dark ? 'rgba(245,236,220,.2)' : T.line2}`,
    background: primary ? (dark ? T.accent : T.ink) : 'transparent',
    color: primary ? (dark ? T.ink : T.bg) : 'inherit',
    padding: '7px 13px', borderRadius: 999, fontSize: 12, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer',
  };
}

export default function DemoPage() {
  const [phase, setPhase] = useState('act1');
  const [idx, setIdx]     = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed]   = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [fromTelegram, setFromTelegram] = useState(false);

  // Responsive detection + Telegram context
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    // Detect if opened via Telegram startapp=demo deep link
    const twa = window.Telegram?.WebApp;
    if (twa?.initDataUnsafe?.start_param === 'demo' || twa?.initData) {
      setFromTelegram(true);
      twa.ready?.();
      twa.expand?.();
    }
    return () => window.removeEventListener('resize', check);
  }, []);

  // Timer engine
  useEffect(() => {
    if (!playing) return;

    if (phase === 'act1') {
      if (idx >= ACT1.length) {
        const t = setTimeout(() => { setPhase('interlude'); setIdx(0); }, 1800 / speed);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setIdx(i => i + 1), ACT1[idx].delay / speed);
      return () => clearTimeout(t);
    }

    if (phase === 'interlude') {
      const t = setTimeout(() => { setPhase('act2'); setIdx(0); }, 4000 / speed);
      return () => clearTimeout(t);
    }

    if (phase === 'act2') {
      if (idx >= ACT2.length) {
        const t = setTimeout(() => setPhase('act3'), 2200 / speed);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setIdx(i => i + 1), ACT2[idx].delay / speed);
      return () => clearTimeout(t);
    }
    // act3 is static
  }, [phase, idx, playing, speed]);

  const reset = () => { setPhase('act1'); setIdx(0); setPlaying(true); };
  const skip  = () => {
    if (phase === 'act1')      { setPhase('interlude'); setIdx(0); }
    else if (phase === 'interlude') { setPhase('act2'); setIdx(0); }
    else if (phase === 'act2') { setPhase('act3'); setIdx(ACT2.length); }
  };

  const progress = phase === 'act1'      ? (idx / ACT1.length) * 32
    : phase === 'interlude'              ? 38
    : phase === 'act2'                   ? 40 + (idx / ACT2.length) * 40
    : 100;

  const phaseLabel = {
    act1:      'Act I · Without MiniMe',
    interlude: 'Intermission',
    act2:      'Act II · With MiniMe',
    act3:      'Act III · The Debrief',
  }[phase];

  const isDark = phase === 'act1' || phase === 'interlude';

  const chromeStyle = {
    padding: isMobile ? '10px 14px' : '14px 28px',
    background:     isDark ? '#0E0907' : T.paper,
    color:          isDark ? DK.bg2 : T.ink,
    borderBottom:   `1px solid ${isDark ? 'rgba(245,236,220,.08)' : T.line}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0, transition: 'all .8s', gap: 12,
    flexWrap: isMobile ? 'wrap' : 'nowrap',
  };

  return (
    <>
      {/* CSS animations */}
      <style>{`
        @keyframes mmTypingDot {
          0%,60%,100% { opacity:.2; transform:translateY(0) }
          30% { opacity:1; transform:translateY(-3px) }
        }
        @keyframes mmSlideUp {
          from { opacity:0; transform:translateY(14px) }
          to   { opacity:1; transform:translateY(0) }
        }
        @keyframes mmSlideUpL {
          from { opacity:0; transform:translateY(20px) }
          to   { opacity:1; transform:translateY(0) }
        }
        @keyframes mmFadeIn {
          from { opacity:0 }
          to   { opacity:1 }
        }
        @keyframes mmFadeInBlur {
          from { opacity:0; filter:blur(8px) }
          to   { opacity:1; filter:blur(0) }
        }
        @keyframes mmPulse {
          0%,100% { opacity:1 }
          50%     { opacity:.4 }
        }
        @keyframes mmGlow {
          0%,100% { box-shadow:0 0 0 0 rgba(217,164,65,0) }
          50%     { box-shadow:0 0 0 14px rgba(217,164,65,.08) }
        }
        @keyframes mmRiseIn {
          from { opacity:0; transform:translateY(40px) scale(.97); filter:blur(4px) }
          to   { opacity:1; transform:translateY(0) scale(1); filter:blur(0) }
        }
        @keyframes mmDrift {
          0%,100% { transform:translateY(0) }
          50%     { transform:translateY(-6px) }
        }
        @keyframes mmStress {
          0%,100% { transform:translate(0,0) rotate(0) }
          25%  { transform:translate(.5px,-.5px) rotate(-.2deg) }
          50%  { transform:translate(-.5px,.5px) rotate(.2deg) }
          75%  { transform:translate(.5px,.5px) rotate(-.1deg) }
        }
        @keyframes mmSweep {
          0%   { transform:translateX(-100%) }
          100% { transform:translateX(100%) }
        }
        @keyframes mmGrow {
          from { transform:scaleY(0); transform-origin:bottom }
          to   { transform:scaleY(1); transform-origin:bottom }
        }
        @keyframes mmFlicker {
          0%,100% { opacity:1 }
          50%     { opacity:.7 }
        }
      `}</style>

      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: isDark ? '#0E0907' : T.bg, transition: 'background .8s' }}>
        {/* Top chrome bar */}
        <div style={chromeStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {fromTelegram ? (
              <Link href="/onboarding" style={{ textDecoration: 'none', fontSize: 12, fontWeight: 600, color: isDark ? DK.accent : T.primary, lineHeight: 1, border: `1px solid ${isDark ? DK.accent + '55' : T.primary + '55'}`, padding: '5px 12px', borderRadius: 999 }}>
                Get started →
              </Link>
            ) : (
              <Link href="/" style={{ textDecoration: 'none', opacity: .5, fontSize: 13, color: 'inherit', lineHeight: 1, transition: 'opacity .15s' }}
                onMouseEnter={e => e.currentTarget.style.opacity = 1}
                onMouseLeave={e => e.currentTarget.style.opacity = .5}
              >← Home</Link>
            )}
            <span style={{ fontFamily: SERIF, fontSize: isMobile ? 18 : 22, fontStyle: 'italic', letterSpacing: '-.025em', fontWeight: 400, lineHeight: 1 }}>
              MiniMe<span style={{ color: isDark ? DK.danger : T.primary, transition: 'color .8s' }}>.</span>
            </span>
            {!isMobile && (
              <span style={{ fontFamily: MONO, fontSize: 10, opacity: .55, letterSpacing: '.22em', textTransform: 'uppercase' }}>A Tale of Two Tuesdays</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14, flexWrap: 'wrap' }}>
            {!isMobile && (
              <span style={{ fontSize: 11, opacity: .65, fontFamily: SERIF, fontStyle: 'italic' }}>{phaseLabel}</span>
            )}
            {!isMobile && (
              <div style={{ width: 200, height: 2, background: isDark ? 'rgba(245,236,220,.12)' : T.line, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: isDark ? 'linear-gradient(90deg,#D9A441,#E0654E)' : `linear-gradient(90deg, ${T.primary}, ${T.accent})`, transition: 'width .5s ease, background .8s' }} />
              </div>
            )}
            <button onClick={() => setPlaying(p => !p)} style={ctrlBtn(phase)}>{playing ? '❙❙' : '▶'}</button>
            <button onClick={() => setSpeed(s => s === 1 ? 2 : s === 2 ? 0.5 : 1)} style={ctrlBtn(phase)}>{speed}×</button>
            <button onClick={skip}  style={ctrlBtn(phase)}>Skip ⤳</button>
            <button onClick={reset} style={ctrlBtn(phase, true)}>↻ Replay</button>
          </div>
        </div>

        {/* Scene */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          <div key={phase} style={{ position: 'absolute', inset: 0, animation: 'mmFadeIn .6s ease-out both', overflow: isMobile && (phase === 'act1' || phase === 'act2' || phase === 'act3') ? 'auto' : 'hidden' }}>
            {phase === 'act1'      && <ActOne     idx={idx} isMobile={isMobile} />}
            {phase === 'interlude' && <Interlude />}
            {phase === 'act2'      && <ActTwo     idx={idx} isMobile={isMobile} />}
            {phase === 'act3'      && <ActThree   isMobile={isMobile} />}
          </div>
        </div>
      </div>
    </>
  );
}
