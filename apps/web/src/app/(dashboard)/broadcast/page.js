'use client';
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../../context/TelegramContext';
import { tgConfirm } from '../../../lib/utils';

const INK   = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const GOLD  = '#B08A4A';
const MINT  = '#4FA38A';
const LINE  = '#E4DED1';
const MUTED = '#8A9590';
const ERROR = '#B85450';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const MONO  = "'Geist Mono', ui-monospace, monospace";

const SEGMENTS = [
  { key: 'all',           label: '📢 Everyone',          desc: 'All customers who have messaged your bot' },
  { key: 'ordered',       label: '🛒 Buyers only',        desc: 'Customers who placed at least 1 order' },
  { key: 'never_ordered', label: '👋 Never ordered',      desc: 'Customers who haven\'t bought yet — nurture them' },
  { key: 'inactive_30d',  label: '😴 Inactive 30 days',   desc: 'No activity in 30 days — re-engage them' },
  { key: 'gold',          label: '🥇 Gold tier',           desc: 'Top customers (500+ loyalty points)' },
  { key: 'silver',        label: '🥈 Silver & above',      desc: 'Loyal customers (100+ points)' },
  { key: 'bronze',        label: '🥉 Bronze & above',      desc: 'All loyalty members' },
];

export default function BroadcastPage() {
  const { initData } = useTelegram() || {};
  const [segment, setSegment]   = useState('all');
  const [message, setMessage]   = useState('');
  const [count, setCount]       = useState(null);
  const [sending, setSending]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState('');
  const [discounts, setDiscounts] = useState([]);

  useEffect(() => {
    if (!initData) return;
    fetch('/api/discounts', { headers: { 'x-telegram-init-data': initData } })
      .then(r => r.json())
      .then(j => setDiscounts((j.discounts || []).filter(d => d.is_active && (!d.expires_at || new Date(d.expires_at) > new Date()) && (!d.max_uses || d.used_count < d.max_uses))))
      .catch(() => {});
  }, [initData]);

  // Fetch recipient count when segment changes
  useEffect(() => {
    if (!initData) return;
    setCount(null);
    fetch(`/api/broadcast?segment=${segment}`, {
      headers: { 'x-telegram-init-data': initData },
    })
      .then(r => r.json())
      .then(j => setCount(j.count ?? 0))
      .catch(() => setCount(null));
  }, [segment, initData]);

  async function send() {
    if (!message.trim() || !initData || sending) return;
    if (!count || count === 0) { setError('No customers in this segment.'); return; }

    const ok = await tgConfirm(`Send this message to ${count} customer${count !== 1 ? 's' : ''}? This can't be undone.`);
    if (!ok) return;

    setSending(true); setError(''); setResult(null);
    try {
      const r = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ message: message.trim(), segment }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Send failed');
      setResult(j);
      setMessage('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  const charsLeft = 4096 - message.length;

  return (
    <div style={{ fontFamily: BODY, color: INK, maxWidth: 520, paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 4 }}>
          Broadcast
        </div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 28, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Message your customers
        </h1>
        <p style={{ fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.5 }}>
          Send a Telegram message to a group of customers at once — promotions, new arrivals, announcements.
        </p>
      </div>

      {/* Success state */}
      {result && (
        <div style={{
          background: 'rgba(79,163,138,0.1)', border: '1px solid rgba(79,163,138,0.3)',
          borderRadius: 14, padding: '16px 18px', marginBottom: 20,
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 24 }}>🎉</span>
          <div>
            <div style={{ fontWeight: 600, color: MINT, fontSize: 15 }}>Broadcast sent!</div>
            <div style={{ fontSize: 13, color: '#2A5A4A', marginTop: 3 }}>
              Delivered to <strong>{result.sent}</strong> customer{result.sent !== 1 ? 's' : ''}
              {result.failed > 0 ? ` · ${result.failed} unreachable (blocked bot or no Telegram)` : ''}
            </div>
          </div>
        </div>
      )}

      {/* Segment picker */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
          Who receives this
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SEGMENTS.map(s => (
            <button
              key={s.key}
              onClick={() => { setSegment(s.key); setResult(null); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                border: `1.5px solid ${segment === s.key ? INK : LINE}`,
                background: segment === s.key ? INK : '#fff',
                color: segment === s.key ? PAPER : INK,
                fontFamily: BODY, textAlign: 'left', transition: 'all .15s ease',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{s.label}</div>
                <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 2 }}>{s.desc}</div>
              </div>
              {segment === s.key && count !== null && (
                <div style={{
                  background: 'rgba(244,238,225,0.2)', borderRadius: 999,
                  padding: '3px 10px', fontSize: 12, fontWeight: 700, flexShrink: 0,
                }}>
                  {count} {count === 1 ? 'person' : 'people'}
                </div>
              )}
            </button>
          ))}
        </div>
        {segment !== 'all' && count !== null && (
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8, paddingLeft: 2 }}>
            {count === 0
              ? 'No customers in this segment yet.'
              : `${count} customer${count !== 1 ? 's' : ''} will receive this message.`}
          </div>
        )}
      </div>

      {/* Message composer */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
            Your message
          </div>
          <div style={{ fontSize: 11, color: charsLeft < 200 ? ERROR : MUTED, fontFamily: MONO }}>
            {charsLeft} left
          </div>
        </div>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={`Hey everyone! 👋\n\nWe just got new arrivals in — come check them out.\n\nShop now via this bot or visit us at Bole Road 🛍️`}
          rows={7}
          maxLength={4096}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            padding: '13px 14px', borderRadius: 12,
            border: `1.5px solid ${LINE}`, background: '#fff',
            fontFamily: BODY, fontSize: 15, lineHeight: 1.55, color: INK, outline: 'none',
            transition: 'border-color .15s',
          }}
          onFocus={e => e.target.style.borderColor = INK}
          onBlur={e => e.target.style.borderColor = LINE}
        />
        {/* Promo code quick-insert */}
        {discounts.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>🏷️ Insert code:</span>
            {discounts.slice(0, 5).map(d => (
              <button
                key={d.id}
                onClick={() => {
                  const valStr = d.type === 'percent' ? `${d.value}% off` : `${d.value} ETB off`;
                  const line = `\n\n🎉 Use code *${d.code}* for ${valStr}!`;
                  setMessage(m => m.endsWith(line) ? m : m + line);
                }}
                style={{
                  background: 'rgba(176,138,74,0.1)', border: '1px solid rgba(176,138,74,0.3)',
                  color: GOLD, borderRadius: 999, padding: '3px 10px',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: BODY,
                  letterSpacing: '0.04em',
                }}
              >
                {d.code}
              </button>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
          💡 You can use *bold*, _italic_, and links in your message.
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(184,84,80,0.08)', border: '1px solid rgba(184,84,80,0.25)',
          borderRadius: 10, padding: '10px 14px', fontSize: 13, color: ERROR, marginBottom: 14,
        }}>{error}</div>
      )}

      {/* Send button */}
      <button
        onClick={send}
        disabled={sending || !message.trim() || count === 0}
        style={{
          width: '100%', appearance: 'none', border: 0,
          background: sending || !message.trim() || count === 0 ? '#C8C0B8' : INK,
          color: PAPER, padding: '16px', borderRadius: 999,
          fontSize: 15, fontWeight: 500, cursor: sending || !message.trim() || count === 0 ? 'default' : 'pointer',
          fontFamily: BODY, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'background .15s',
        }}
      >
        {sending ? (
          <>Sending…</>
        ) : (
          <>
            📤 Send to {count ?? '…'} customer{count !== 1 ? 's' : ''}
          </>
        )}
      </button>

      <p style={{ fontSize: 11.5, color: MUTED, textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
        Limited to 1 broadcast every 5 minutes · Max 500 recipients per send
      </p>

      {/* Broadcast history */}
      <BroadcastHistory initData={initData} />
    </div>
  );
}

function BroadcastHistory({ initData }) {
  const { business } = useTelegram() || {};
  const history = business?.notification_prefs?.broadcast_history || [];
  if (!history.length) return null;

  const SEGMENT_LABELS = { all: 'Everyone', gold: 'Gold tier', silver: 'Silver & above', bronze: 'Bronze & above', ordered: 'Buyers only' };
  const BODY = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
        Recent broadcasts
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {history.map(h => (
          <div key={h.id} style={{
            background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12,
            padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 13, color: INK, flex: 1, lineHeight: 1.4 }}>
                {h.message}{h.message.length >= 200 ? '…' : ''}
              </div>
              <div style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>
                {new Date(h.sent_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
              <span style={{ color: MINT, fontWeight: 600 }}>✓ {h.sent_count} sent</span>
              {h.failed_count > 0 && <span style={{ color: MUTED }}>{h.failed_count} failed</span>}
              <span style={{ color: MUTED }}>{SEGMENT_LABELS[h.segment] || h.segment}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
