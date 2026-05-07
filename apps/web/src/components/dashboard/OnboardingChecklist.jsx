'use client';
/**
 * Post-onboarding "what to do next" checklist — editorial Espresso style.
 * Each item is derived from real data; hides when complete or dismissed.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const SERIF = "'Fraunces', Georgia, serif";
const AMH = "'Noto Serif Ethiopic', serif";
const MONO = "'JetBrains Mono', monospace";

export default function OnboardingChecklist({ businessId, initData }) {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem(`mm_checklist_${businessId}_dismissed`)) {
      setDismissed(true);
    }
  }, [businessId]);

  useEffect(() => {
    if (!initData || dismissed) return;
    (async () => {
      const r = await fetch('/api/onboarding/checklist', {
        headers: { 'x-telegram-init-data': initData },
        cache: 'no-store',
      });
      const j = await r.json();
      setState(j);
    })();
  }, [initData, dismissed]);

  if (dismissed || !state) return null;

  const items = [
    { key: 'taught',     label: 'Teach MiniMe about your shop',  am: 'ስለ ሱቅዎ ይንገሩ',     done: state.taught,     onClick: () => router.push('/advisor/teach'), hint: 'Paste a paragraph or upload your price list' },
    { key: 'team',       label: 'Add your first team member',    am: 'ቡድንዎን ይጨምሩ',       done: state.team,       onClick: () => router.push('/agent/team'),    hint: 'Designer, printer, delivery — anyone MiniMe should brief' },
    { key: 'products',   label: 'Add a product or service',      am: 'ምርት ይጨምሩ',          done: state.products,   onClick: () => router.push('/products'),      hint: 'So MiniMe can quote prices accurately' },
    { key: 'dnd',        label: 'Set quiet hours',                am: 'የጸጥታ ሰዓት',          done: state.dnd,        onClick: () => router.push('/settings/hours'), hint: 'When MiniMe should slow down or stop' },
    { key: 'links',      label: 'Add your website / Instagram',  am: 'ድረገፅ / ኢንስታ',       done: state.links,      onClick: () => router.push('/settings'),      hint: 'So MiniMe can share them with clients' },
    { key: 'first_chat', label: 'Get your first client message', am: 'የመጀመሪያ ደንበኛ',       done: state.first_chat, onClick: () => router.push('/conversations'), hint: 'Share your bot link to get started' },
  ];

  const doneCount = items.filter(i => i.done).length;
  if (doneCount === items.length) return null;

  function dismiss() {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`mm_checklist_${businessId}_dismissed`, '1');
    }
  }

  return (
    <section style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 20px 12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8A7560' }}>
            Get started · {doneCount} of {items.length}
          </div>
          <h2 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', color: '#1A0F08', marginTop: 4, lineHeight: 1.2 }}>
            Make MiniMe <em style={{ fontStyle: 'italic', color: '#8B2E1F' }}>yours</em>.
          </h2>
          <div style={{ fontFamily: AMH, fontSize: 12, color: '#8B2E1F', marginTop: 1 }}>MiniMe ያስተካክሉ</div>
        </div>
        <button onClick={dismiss} title="Hide" style={{ appearance: 'none', border: 'none', background: 'transparent', color: '#8A7560', fontSize: 16, padding: 4, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      <ul style={{ borderTop: '1px solid #E8DFD0' }}>
        {items.map((it, idx) => (
          <li key={it.key} style={{ borderTop: idx > 0 ? '1px solid #E8DFD0' : 'none' }}>
            <button
              onClick={it.onClick}
              disabled={it.done}
              style={{
                width: '100%', appearance: 'none', border: 'none', background: 'transparent',
                padding: '14px 18px', textAlign: 'left', cursor: it.done ? 'default' : 'pointer',
                opacity: it.done ? 0.55 : 1, fontFamily: 'inherit',
                display: 'flex', alignItems: 'flex-start', gap: 14,
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 2 }}>
                {it.done ? <CheckMark /> : <CircleMark />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontFamily: SERIF, fontSize: 16, color: it.done ? '#8A7560' : '#1A0F08',
                  textDecoration: it.done ? 'line-through' : 'none',
                  fontStyle: it.done ? 'italic' : 'normal', fontWeight: 400, lineHeight: 1.2,
                }}>{it.label}</span>
                <span style={{ display: 'block', fontFamily: AMH, fontSize: 11, color: '#8B2E1F', marginTop: 1 }}>{it.am}</span>
                {!it.done && <span style={{ display: 'block', fontSize: 11.5, color: '#8A7560', marginTop: 4, fontStyle: 'italic', fontFamily: SERIF }}>{it.hint}</span>}
              </span>
              {!it.done && <span style={{ color: '#8B2E1F', fontSize: 14, flexShrink: 0, marginTop: 2 }}>›</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CheckMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill="#5A7A3F" />
      <path d="M5 8.2l2 2 4-4.4" stroke="#FBF6EC" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
function CircleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#D9CCB8" strokeWidth="1.4" />
    </svg>
  );
}
