'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTelegram } from '../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../lib/design-tokens';

const SERIF = "'Newsreader', Georgia, serif";

const SUGGESTIONS = [
  'Plan my day',
  'Remind me to call mom at 6pm',
  "What's on for me?",
  'Message a customer for me',
];

export default function AssistantPage() {
  const { initData } = useTelegram() || {};
  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef(null);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }, []);

  useEffect(() => {
    if (!initData) return;
    (async () => {
      try {
        const r = await fetch('/api/agent/assistant', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
        const j = await r.json();
        if (Array.isArray(j.history)) setMessages(j.history.filter(m => m.role && m.content));
      } catch {} finally { setLoaded(true); scrollDown(); }
    })();
  }, [initData, scrollDown]);

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || sending || !initData) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setSending(true);
    scrollDown();
    try {
      const r = await fetch('/api/agent/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ message: msg }),
      });
      const j = await r.json();
      const replies = Array.isArray(j.replies) && j.replies.length ? j.replies : ['…'];
      setMessages(prev => [...prev, ...replies.map(content => ({ role: 'assistant', content }))]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Something went wrong — try again.' }]);
    } finally {
      setSending(false);
      scrollDown();
    }
  }

  return (
    <div style={{ fontFamily: FONT.body, color: COLORS.textPrimary, maxWidth: 620, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#B08A4A', marginBottom: 6 }}>Assistant</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 24, margin: 0, letterSpacing: '-0.02em' }}>Your assistant</h1>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '4px 0 0' }}>Ask anything, plan your day, or have it message people for you — same as chatting your bot on Telegram.</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
        {loaded && messages.length === 0 && (
          <div style={{ color: COLORS.textHint, fontSize: 14, padding: '20px 4px', lineHeight: 1.6 }}>
            👋 Hi — I&rsquo;m your assistant. Try one of these:
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} style={{
                  background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 999,
                  padding: '8px 14px', fontSize: 13, color: COLORS.textPrimary, cursor: 'pointer', fontFamily: FONT.body,
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
            <div style={{
              background: m.role === 'user' ? COLORS.textPrimary : COLORS.surface,
              color: m.role === 'user' ? '#fff' : COLORS.textPrimary,
              border: m.role === 'user' ? 'none' : `1px solid ${COLORS.border}`,
              borderRadius: 16, padding: '10px 14px', fontSize: 14, lineHeight: 1.5,
              whiteSpace: 'pre-wrap', boxShadow: m.role === 'user' ? 'none' : SHADOW.card,
            }}>{m.content}</div>
          </div>
        ))}
        {sending && (
          <div style={{ alignSelf: 'flex-start', color: COLORS.textHint, fontSize: 13, padding: '6px 4px' }}>typing…</div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message your assistant…"
          style={{
            flex: 1, padding: '12px 14px', borderRadius: RADII.lg, border: `1px solid ${COLORS.border}`,
            background: COLORS.surface, fontSize: 15, fontFamily: FONT.body, color: COLORS.textPrimary, outline: 'none',
          }}
        />
        <button onClick={() => send()} disabled={!input.trim() || sending} style={{
          background: input.trim() && !sending ? COLORS.textPrimary : COLORS.border,
          color: input.trim() && !sending ? '#fff' : COLORS.textHint,
          border: 'none', borderRadius: RADII.lg, padding: '0 18px', fontSize: 14, fontWeight: 600,
          cursor: input.trim() && !sending ? 'pointer' : 'default', fontFamily: FONT.body,
        }}>Send</button>
      </div>
    </div>
  );
}
