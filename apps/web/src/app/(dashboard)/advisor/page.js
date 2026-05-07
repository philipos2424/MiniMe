'use client';
/**
 * Advisor — redesigned with design tokens.
 * Chat UI with suggestion chips, AI replies with action buttons.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../lib/design-tokens';

const CHIPS = [
  { icon: '🎯', q: 'What should I focus on today?' },
  { icon: '👥', q: 'Tell me about my clients' },
  { icon: '🧠', q: 'What did you learn this week?' },
  { icon: '💰', q: 'Which deals am I losing?' },
  { icon: '📊', q: 'How was my week?' },
  { icon: '⭐', q: 'Who should I prioritize?' },
];

export default function AdvisorPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function ask(q) {
    const question = (q || input).trim();
    if (!question || busy) return;
    setInput('');
    setMessages(m => [...m, { role: 'owner', text: question }]);
    setBusy(true);
    try {
      const r = await fetch('/api/advisor/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ question }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setMessages(m => [...m, { role: 'advisor', text: j.response || '(no reply)', actions: j.suggestedActions || [] }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'advisor', text: `⚠️ ${e.message || 'failed'}`, actions: [] }]);
    } finally { setBusy(false); }
  }

  async function runAction(a) {
    if (a.kind === 'open_client' || a.kind === 'draft_reply') {
      try {
        const r = await fetch(`/api/advisor/resolve-client?q=${encodeURIComponent(a.client || '')}`, { headers: { 'x-telegram-init-data': initData } });
        const j = await r.json();
        if (j.conversation_id) { router.push(`/conversations/${j.conversation_id}`); return; }
      } catch {}
      router.push(`/conversations?q=${encodeURIComponent(a.client || '')}`); return;
    }
    if (a.kind === 'open_job')         { router.push(`/agent/${a.job_id}`); return; }
    if (a.kind === 'open_teach')       { router.push('/agent/knowledge'); return; }
    if (a.kind === 'toggle_dnd')       { router.push('/settings'); return; }
    if (a.kind === 'upgrade_trust')    { router.push('/settings/trust'); return; }
    if (a.kind === 'send_review_request') { ask(`Draft a review request message for ${a.client || 'my happiest client'}`); return; }
  }

  const showChips = messages.length === 0;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 140px)', paddingBottom: 16, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* Header */}
      <header style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>🧠 Advisor</h1>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '2px 0 0' }}>Your business, in plain language.</p>
        </div>
        <button onClick={() => router.push('/advisor/teach')} style={{ fontSize: 13, fontWeight: 600, color: COLORS.teal, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT.body }}>Teach →</button>
      </header>

      {/* Chips */}
      {showChips && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {CHIPS.map(c => (
            <button key={c.q} onClick={() => ask(c.q)} style={{
              textAlign: 'left', background: COLORS.surface, border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.lg, padding: '10px 12px', fontSize: 13, color: COLORS.textPrimary,
              cursor: 'pointer', fontFamily: FONT.body, transition: 'border-color 0.15s', boxShadow: SHADOW.card,
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.teal + '60'}
              onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.border}
            >
              <span style={{ marginRight: 6 }}>{c.icon}</span>{c.q}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {messages.map((m, i) => <MessageBubble key={i} m={m} onAction={runAction} />)}
        {busy && <TypingIndicator />}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form onSubmit={e => { e.preventDefault(); ask(); }} style={{ display: 'flex', gap: 8, position: 'sticky', bottom: 0, background: COLORS.bg, paddingTop: 8, paddingBottom: 4 }}>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          placeholder="Ask anything about your business…"
          disabled={busy}
          style={{
            flex: 1, background: COLORS.surface, border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.lg, padding: '10px 14px', fontSize: 14, color: COLORS.textPrimary,
            fontFamily: FONT.body, outline: 'none', opacity: busy ? 0.5 : 1,
          }}
        />
        <button type="submit" disabled={!input.trim() || busy} style={{
          fontSize: 14, fontWeight: 600, background: (!input.trim() || busy) ? COLORS.textHint : COLORS.teal,
          color: '#FFF', borderRadius: RADII.lg, padding: '10px 16px', border: 'none',
          cursor: (!input.trim() || busy) ? 'default' : 'pointer', fontFamily: FONT.body, transition: 'background 0.15s',
        }}>
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ m, onAction }) {
  if (m.role === 'owner') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ maxWidth: '85%', background: COLORS.teal, color: '#FFF', borderRadius: '16px 16px 4px 16px', padding: '8px 14px', fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          {m.text}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{
        maxWidth: '90%', background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        borderRadius: '16px 16px 16px 4px', padding: '10px 14px', fontSize: 14,
        color: COLORS.textPrimary, whiteSpace: 'pre-wrap', lineHeight: 1.55,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>🧠</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{m.text}</div>
            {m.actions?.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {m.actions.map((a, i) => (
                  <button key={i} onClick={() => onAction(a)} style={{
                    fontSize: 12, fontWeight: 600, background: `${COLORS.teal}18`, border: `1px solid ${COLORS.teal}40`,
                    color: COLORS.textPrimary, borderRadius: RADII.sm, padding: '4px 12px',
                    cursor: 'pointer', fontFamily: FONT.body, transition: 'background 0.15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = `${COLORS.teal}30`}
                    onMouseLeave={e => e.currentTarget.style.background = `${COLORS.teal}18`}
                  >
                    {a.label} →
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: '16px 16px 16px 4px', padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <BounceCircle delay={0} /><BounceCircle delay={150} /><BounceCircle delay={300} />
        </div>
      </div>
    </div>
  );
}

function BounceCircle({ delay }) {
  return (
    <span className="animate-bounce" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: COLORS.textHint, animationDelay: `${delay}ms` }} />
  );
}
