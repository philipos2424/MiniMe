'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { isAmharic } from '../../lib/design-tokens';

// ─── Review sheet — bottom sheet listing drafts waiting for approval ───────
// Opened from the Home focus card ("Review replies →"). Reuses the exact
// approve/skip endpoints the inline DraftCard on Home already uses, so
// sending here and sending from /conversations behave identically.

const INK   = '#0E2823';
const CREAM = '#F4EEE1';
const MINT  = '#4FA38A';
const MUTED = '#8A9590';
const LINE  = '#E4DED1';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const AMH   = "'Noto Sans Ethiopic', 'Geist', sans-serif";

function Avatar({ name = '?' }) {
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{
      width: 38, height: 38, borderRadius: '50%', background: '#EDE6D6',
      display: 'grid', placeItems: 'center', fontFamily: SERIF, fontSize: 16, color: INK, flexShrink: 0,
    }}>{letter}</div>
  );
}

function ReviewDraftRow({ m, onGone }) {
  const { initData } = useTelegram() || {};
  const isAmh = isAmharic(m.preview);
  const [state, setState] = useState('idle'); // idle | busy | sent

  async function act(kind) {
    if (!m.draft_id || !initData || state !== 'idle') return;
    setState('busy');
    try {
      await fetch(`/api/messages/${m.draft_id}/${kind}`, {
        method: 'POST', headers: { 'x-telegram-init-data': initData },
      });
      if (kind === 'approve') {
        setState('sent');
        setTimeout(() => onGone?.(m.conversation_id), 700);
      } else {
        onGone?.(m.conversation_id);
      }
    } catch { setState('idle'); }
  }

  return (
    <div style={{ marginTop: 14, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <Avatar name={m.client_name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: 15, color: INK }}>{m.client_name}</div>
          <div style={{ fontSize: 12, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: isAmh ? AMH : BODY }}>{m.preview}</div>
        </div>
        {state === 'sent' && (
          <span style={{ background: 'rgba(79,163,138,.14)', color: '#3C8E77', padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>SENT ✓</span>
        )}
      </div>
      {m.draft_preview && (
        <div style={{ marginTop: 11, padding: '11px 13px', background: CREAM, borderRadius: 12, fontSize: 13, lineHeight: 1.45, color: INK }}>
          {m.draft_preview}
        </div>
      )}
      {state !== 'sent' && m.draft_id && (
        <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
          <button onClick={() => act('approve')} disabled={state === 'busy'} style={{
            flex: 2, background: MINT, color: '#fff', padding: 11, borderRadius: 11,
            fontSize: 13.5, fontWeight: 600, border: 'none', cursor: state === 'busy' ? 'default' : 'pointer', fontFamily: BODY,
          }}>
            {state === 'busy' ? '…' : '✓ Send'}
          </button>
          <Link href={`/conversations/${m.conversation_id}?focusDraft=1`} style={{
            flex: 1, border: `1px solid ${LINE}`, background: '#fff', padding: 11, borderRadius: 11,
            fontSize: 13.5, textAlign: 'center', color: INK, textDecoration: 'none',
          }}>Edit</Link>
        </div>
      )}
    </div>
  );
}

export function ReviewSheet({ open, drafts, onClose }) {
  const [dismissed, setDismissed] = useState([]);
  if (!open) return null;

  const visible = (drafts || []).filter(d => !dismissed.includes(d.conversation_id));

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(14,40,35,.5)', zIndex: 100,
      display: 'flex', alignItems: 'flex-end',
    }}>
      <div onClick={e => e.stopPropagation()} className="fade-up" style={{
        background: '#FFFFFF', borderRadius: '26px 26px 0 0', width: '100%',
        boxSizing: 'border-box', padding: '18px 22px calc(24px + env(safe-area-inset-bottom))',
        maxHeight: '82vh', overflowY: 'auto',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: '#E0D8C6', margin: '0 auto 14px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: SERIF, fontSize: 22, color: INK }}>Replies to approve</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: MUTED, cursor: 'pointer', lineHeight: 1, fontFamily: BODY }}>×</button>
        </div>

        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0 6px' }}>
            <div style={{ fontFamily: SERIF, fontSize: 18, color: '#3C8E77' }}>All caught up 🎉</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>Nothing else needs you right now.</div>
          </div>
        ) : (
          visible.map(m => (
            <ReviewDraftRow key={m.conversation_id} m={m} onGone={id => setDismissed(prev => [...prev, id])} />
          ))
        )}

        <button onClick={onClose} style={{
          width: '100%', marginTop: 18, padding: 14, borderRadius: 999, border: 'none',
          background: INK, color: '#FFFFFF', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: BODY,
        }}>Done</button>
      </div>
    </div>
  );
}
