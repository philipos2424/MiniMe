'use client';
import { INK, MUTED, TEAL, SERIF } from '../lib';

/** Zero-results block with the "notify me when available" waitlist hook. */
export default function EmptyState({ q, notifyState, onNotify }) {
  return (
    <div className="mk-empty">
      <div className="big">😔</div>
      <div style={{ fontFamily: SERIF, fontSize: 18, color: INK }}>
        We don't have{q.trim() ? ` “${q.trim()}”` : ' that'} at the moment
      </div>
      {notifyState === 'done' ? (
        <div style={{ fontSize: 14, marginTop: 10, color: TEAL, fontWeight: 600 }}>
          ✅ Done — we'll message you on Telegram the moment a shop has it.
        </div>
      ) : notifyState === 'bot' ? (
        <div style={{ fontSize: 13, marginTop: 10 }}>
          Open{' '}
          <a href="https://t.me/MiniMeSearchBot" style={{ color: TEAL, fontWeight: 600 }}>@MiniMeSearchBot</a>
          {' '}and we'll message you when it's available.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, marginTop: 6, color: MUTED }}>
            Shall we message you when it's available?
          </div>
          <button
            onClick={onNotify}
            disabled={notifyState === 'saving'}
            style={{ marginTop: 14, border: 'none', background: TEAL, color: '#fff', font: 'inherit',
                     fontSize: 14, fontWeight: 600, padding: '11px 20px', borderRadius: 12, cursor: 'pointer' }}
          >
            {notifyState === 'saving' ? 'Saving…' : '🔔 Notify me when available'}
          </button>
          <div style={{ fontSize: 12, marginTop: 12, color: MUTED }}>
            or ask our AI finder —{' '}
            <a href="https://t.me/MiniMeSearchBot" style={{ color: TEAL, fontWeight: 600 }}>@MiniMeSearchBot</a>
          </div>
        </>
      )}
    </div>
  );
}
