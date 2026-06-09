'use client';
/**
 * DraftApproval — lets the owner send, edit+send, or skip an AI draft.
 *
 * Previously wrote `status: 'approved'` directly to the DB — the message
 * was never actually sent to the customer. Now calls POST /api/messages/[id]/approve
 * which sends via Telegram and marks status='sent'.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, X, Sparkles, Edit2 } from 'lucide-react';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';
import { haptic, hapticNotification } from '../../lib/hooks/useTelegramButtons';

export default function DraftApproval({ message }) {
  const { initData, pendingCount } = useTelegram() || {};
  const [action, setAction]   = useState(null);   // null | 'sending' | 'sent' | 'skipping' | 'skipped'
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
  const [err, setErr]         = useState('');
  const textareaRef           = useRef(null);

  // Focus textarea when edit mode opens
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  async function send(overrideText) {
    if (action || !initData) return;
    haptic('medium');
    setAction('sending');
    setErr('');
    try {
      const body = overrideText ? { edited_content: overrideText } : {};
      const r = await fetch(`/api/messages/${message.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Send failed');
      hapticNotification('success');
      setAction('sent');
    } catch (e) {
      hapticNotification('error');
      setErr(e.message);
      setAction(null);
    }
  }

  async function skip() {
    if (action || !initData) return;
    haptic('light');
    setAction('skipping');
    try {
      const r = await fetch(`/api/messages/${message.id}/skip`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
      });
      if (!r.ok) throw new Error('skip failed');
      setAction('skipped');
    } catch {
      setAction(null);
    }
  }

  // Keyboard shortcuts when not in edit mode
  useEffect(() => {
    if (editing) return;
    function onKey(e) {
      if (action) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); send();
      } else if (e.key === 'Escape') {
        e.preventDefault(); skip();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, editing]);

  // ── Done states ──
  if (action === 'sent') {
    return (
      <div style={{ borderRadius: RADII.lg, overflow: 'hidden', fontFamily: FONT.body }}>
        <div style={{ background: COLORS.greenLight, border: `1px solid ${COLORS.green}40`, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: '12px 14px', color: COLORS.green, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={16} /> Sent to customer
        </div>
        {pendingCount > 0 && (
          <Link href="/conversations?filter=needs_reply" style={{ textDecoration: 'none', display: 'block' }}>
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.green}40`, borderTop: 'none', borderBottomLeftRadius: RADII.lg, borderBottomRightRadius: RADII.lg, padding: '10px 14px', fontSize: 13, fontWeight: 600, color: COLORS.teal, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{pendingCount} more draft{pendingCount !== 1 ? 's' : ''} waiting</span>
              <span style={{ fontSize: 16 }}>→</span>
            </div>
          </Link>
        )}
      </div>
    );
  }
  if (action === 'skipped') return null;

  const pct        = Math.round((message.ai_confidence || 0) * 100);
  const confColor  = pct >= 80 ? COLORS.green : pct >= 60 ? COLORS.teal : COLORS.amber;
  const isSending  = action === 'sending';
  const isSkipping = action === 'skipping';

  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, fontFamily: FONT.body, display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: COLORS.teal, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Sparkles size={10} /> MiniMe drafted
        </span>
        <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic', fontSize: 13, color: confColor }}>
          {pct}% match
        </span>
      </div>

      {/* Confidence bar */}
      <div style={{ height: 3, width: '100%', borderRadius: 999, background: COLORS.bg, overflow: 'hidden' }}>
        <div style={{ height: '100%', background: confColor, width: `${Math.max(4, Math.min(100, pct))}%`, transition: 'width 0.5s ease' }} />
      </div>

      {/* Draft text — or edit textarea */}
      {editing ? (
        <textarea
          ref={textareaRef}
          value={editText}
          onChange={e => setEditText(e.target.value)}
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            border: `1.5px solid ${COLORS.teal}`, borderRadius: RADII.md,
            padding: '10px 12px', fontSize: 14, fontFamily: FONT.body,
            color: COLORS.textPrimary, background: COLORS.bg,
            lineHeight: 1.6, outline: 'none',
          }}
        />
      ) : (
        <div style={{ background: COLORS.bg, border: `1.5px dashed ${confColor}`, borderRadius: RADII.md, padding: '12px 14px' }}>
          <p style={{ fontSize: 14, color: COLORS.textPrimary, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{message.content}</p>
        </div>
      )}

      {/* Error */}
      {err && <div style={{ fontSize: 12, color: COLORS.red }}>{err}</div>}

      {/* Actions */}
      {editing ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => send(editText)}
            disabled={!editText.trim() || isSending}
            style={btnStyle(COLORS.teal, '#FFF', 2, isSending)}
          >
            <Check size={16} /> {isSending ? 'Sending…' : 'Send edited'}
          </button>
          <button
            onClick={() => { setEditing(false); setEditText(message.content || ''); }}
            style={btnStyle('transparent', COLORS.textSecondary, 1, false, COLORS.border)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => send()}
            disabled={isSending || isSkipping}
            style={btnStyle(COLORS.teal, '#FFF', 2, isSending || isSkipping)}
          >
            <Check size={16} /> {isSending ? 'Sending…' : 'Send'}
          </button>
          <button
            onClick={() => setEditing(true)}
            disabled={isSending || isSkipping}
            style={btnStyle('transparent', COLORS.teal, 1, isSending || isSkipping, COLORS.teal + '40')}
          >
            <Edit2 size={14} /> Edit
          </button>
          <button
            onClick={skip}
            disabled={isSending || isSkipping}
            style={btnStyle('transparent', COLORS.textSecondary, 1, isSending || isSkipping, COLORS.border)}
          >
            <X size={14} /> {isSkipping ? '…' : 'Skip'}
          </button>
        </div>
      )}

      {!editing && (
        <p style={{ fontSize: 10.5, color: COLORS.textHint, textAlign: 'center', margin: 0 }}>
          <kbd style={{ fontFamily: 'monospace', fontSize: 10 }}>Enter</kbd> send · <kbd style={{ fontFamily: 'monospace', fontSize: 10 }}>Esc</kbd> skip
        </p>
      )}
    </div>
  );
}

function btnStyle(bg, color, flex, disabled, borderColor) {
  return {
    flex, minHeight: 44, background: disabled ? COLORS.border : bg,
    color: disabled ? COLORS.textHint : color,
    fontSize: 14, fontWeight: 600, padding: '10px 12px', borderRadius: 999,
    border: `1px solid ${borderColor || 'transparent'}`,
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    fontFamily: FONT.body, transition: 'opacity 0.15s', opacity: disabled ? 0.6 : 1,
  };
}
