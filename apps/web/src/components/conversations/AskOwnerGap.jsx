'use client';
/**
 * AskOwnerGap — shown when MiniMe held a customer instead of guessing because
 * it hit a question it wasn't taught (see askOwnerForKnowledgeGap in
 * replyEngine.js). Lets the owner answer right here instead of switching to
 * Telegram; the answer is relayed to the customer AND learned as an FAQ so
 * the same question is never asked again.
 */
import { useState } from 'react';
import { Send } from 'lucide-react';
import { useTelegram } from '../../context/TelegramContext';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';
import { haptic, hapticNotification } from '../../lib/hooks/useTelegramButtons';

export default function AskOwnerGap({ conversationId, question, onResolved }) {
  const { initData } = useTelegram() || {};
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  async function send() {
    if (!answer.trim() || sending || !initData) return;
    haptic('medium');
    setSending(true);
    setErr('');
    try {
      const r = await fetch(`/api/conversations/${conversationId}/answer-gap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ answer: answer.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not send');
      hapticNotification('success');
      setSent(true);
      onResolved?.();
    } catch (e) {
      hapticNotification('error');
      setErr(e.message);
    } finally {
      setSending(false);
    }
  }

  if (sent) return null; // realtime message list already shows the sent answer

  return (
    <div style={{ background: COLORS.surface, border: `1.5px solid ${COLORS.amber}`, borderRadius: RADII.lg, padding: 16, fontFamily: FONT.body, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: COLORS.amber, fontWeight: 600 }}>
        🤔 MiniMe doesn't know this one
      </span>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>
        The customer was told you'd check and get back to them. Answer below — I'll send it and remember it for next time.
      </p>
      {question && (
        <div style={{ background: COLORS.bg, borderRadius: RADII.md, padding: '10px 12px', fontSize: 13, color: COLORS.textPrimary, fontStyle: 'italic' }}>
          "{question}"
        </div>
      )}
      <textarea
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        rows={2}
        placeholder="Type the answer…"
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          border: `1.5px solid ${COLORS.border}`, borderRadius: RADII.md,
          padding: '10px 12px', fontSize: 14, fontFamily: FONT.body,
          color: COLORS.textPrimary, background: COLORS.bg, lineHeight: 1.6, outline: 'none',
        }}
      />
      {err && <div style={{ fontSize: 12, color: COLORS.red }}>{err}</div>}
      <button
        onClick={send}
        disabled={!answer.trim() || sending}
        style={{
          minHeight: 40, background: !answer.trim() || sending ? COLORS.border : COLORS.teal,
          color: !answer.trim() || sending ? COLORS.textHint : '#FFF',
          fontSize: 14, fontWeight: 600, padding: '10px 12px', borderRadius: 999,
          border: 'none', cursor: !answer.trim() || sending ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontFamily: FONT.body,
        }}
      >
        <Send size={14} /> {sending ? 'Sending…' : 'Send & teach MiniMe'}
      </button>
    </div>
  );
}
