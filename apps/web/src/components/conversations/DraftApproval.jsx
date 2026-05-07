'use client';
import { useEffect, useState } from 'react';
import { Check, X, Sparkles } from 'lucide-react';
import { useSupabase } from '../../hooks/useSupabase';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

export default function DraftApproval({ message }) {
  const supabase = useSupabase();
  const [action, setAction] = useState(null);

  async function approve() {
    if (action) return;
    setAction('approving');
    await supabase
      .from('messages')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', message.id);
    setAction('approved');
  }

  async function skip() {
    if (action) return;
    setAction('skipping');
    await supabase.from('messages').update({ status: 'skipped' }).eq('id', message.id);
    setAction('skipped');
  }

  useEffect(() => {
    function onKey(e) {
      if (action) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        approve();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        skip();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (action === 'approved') {
    return (
      <div style={{ background: COLORS.greenLight, border: `1px solid ${COLORS.green}40`, borderRadius: RADII.lg, padding: 12, color: COLORS.green, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Check size={16} /> Approved and sent
      </div>
    );
  }
  if (action === 'skipped') return null;

  const pct = Math.round((message.ai_confidence || 0) * 100);
  const confColor = pct >= 80 ? COLORS.green : pct >= 60 ? COLORS.teal : COLORS.amber;
  const confBorder = pct >= 80 ? COLORS.green : pct >= 60 ? COLORS.teal : COLORS.amber;

  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, fontFamily: FONT.body, display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Header: label + confidence badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase',
          color: COLORS.teal, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <Sparkles size={10} /> MiniMe drafted
        </span>
        <span style={{
          fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic',
          fontSize: 13, color: confColor, fontWeight: 400,
        }}>
          {pct}% match
        </span>
      </div>

      {/* Confidence bar */}
      <div style={{ height: 3, width: '100%', borderRadius: 999, background: COLORS.bg, overflow: 'hidden' }}>
        <div style={{ height: '100%', background: confColor, width: `${Math.max(4, Math.min(100, pct))}%`, transition: 'width 0.5s ease' }} />
      </div>

      {/* Draft message — dashed border */}
      <div style={{
        background: COLORS.bg, border: `1.5px dashed ${confBorder}`,
        borderRadius: RADII.md, padding: '12px 14px',
      }}>
        <p style={{ fontSize: 14, color: COLORS.textPrimary, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{message.content}</p>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={approve}
          disabled={!!action}
          style={{
            flex: 2, minHeight: 44, background: COLORS.teal, color: '#FFF',
            fontSize: 14, fontWeight: 600, padding: '10px 0', borderRadius: 999,
            border: 'none', cursor: action ? 'default' : 'pointer', opacity: action ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontFamily: FONT.body, transition: 'opacity 0.15s',
          }}
        >
          <Check size={16} /> Send
        </button>
        <button
          onClick={skip}
          disabled={!!action}
          style={{
            flex: 1, minHeight: 44, padding: '10px 0',
            background: 'transparent', border: `1px solid ${COLORS.border}`,
            color: COLORS.textSecondary, fontSize: 14, borderRadius: 999,
            cursor: action ? 'default' : 'pointer', opacity: action ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontFamily: FONT.body, transition: 'opacity 0.15s',
          }}
        >
          <X size={14} /> Skip
        </button>
      </div>
      <p style={{ fontSize: 10.5, color: COLORS.textHint, textAlign: 'center', margin: 0 }}>
        <kbd style={{ fontFamily: 'monospace', fontSize: 10 }}>Enter</kbd> approve · <kbd style={{ fontFamily: 'monospace', fontSize: 10 }}>Esc</kbd> skip
      </p>
    </div>
  );
}
