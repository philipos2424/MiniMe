'use client';
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../../context/TelegramContext';

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

const STATUS_META = {
  pending:   { label: 'pending',   color: GOLD,  bg: 'rgba(176,138,74,0.12)' },
  delivered: { label: 'awaiting',  color: GOLD,  bg: 'rgba(176,138,74,0.12)' },
  replied:   { label: 'replied',   color: MINT,  bg: 'rgba(79,163,138,0.12)' },
  declined:  { label: 'declined',  color: ERROR, bg: 'rgba(184,84,80,0.12)' },
  expired:   { label: 'expired',   color: MUTED, bg: 'rgba(138,149,144,0.12)' },
};

const INTENT_EMOJI = { inquiry: '❓', order: '🛒', coordination: '🤝', chat: '💬', reply: '↩️' };

export default function B2BPage() {
  const { initData } = useTelegram() || {};
  const [tab, setTab] = useState('inbox');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openThread, setOpenThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!initData) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/b2b?tab=${tab}`, { headers: { 'x-telegram-init-data': initData } });
      const j = await r.json();
      setItems(j.items || []);
    } catch (e) { console.warn(e); }
    setLoading(false);
  }, [initData, tab]);

  useEffect(() => { load(); }, [load]);

  const openConversation = async (threadId) => {
    setOpenThread(threadId);
    setThreadMessages([]);
    try {
      const r = await fetch(`/api/b2b?thread=${threadId}`, { headers: { 'x-telegram-init-data': initData } });
      const j = await r.json();
      setThreadMessages(j.messages || []);
    } catch {}
  };

  const sendReply = async (originalMsgId) => {
    if (!replyText.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`/api/b2b`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'reply', original_msg_id: originalMsgId, content: replyText.trim() }),
      });
      setReplyText('');
      if (openThread) await openConversation(openThread);
      await load();
    } catch {}
    setSending(false);
  };

  const decline = async (msgId) => {
    if (!confirm('Decline this message?')) return;
    await fetch(`/api/b2b`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ action: 'decline', msg_id: msgId }),
    });
    if (openThread) await openConversation(openThread);
    await load();
  };

  // Thread view
  if (openThread) {
    const partner = threadMessages[0]
      ? (threadMessages[0].sender_id === threadMessages.find(m => m.sender_id !== threadMessages[0].sender_id)?.recipient_id
          ? threadMessages[0].sender
          : threadMessages[0].recipient)
      : null;
    const partnerName = partner?.name || 'Business';
    const partnerHandle = partner?.telegram_bot_username;
    const lastIncoming = [...threadMessages].reverse().find(m => m.recipient_id && m.status !== 'replied' && m.status !== 'declined');

    return (
      <div style={{ fontFamily: BODY, color: INK, background: PAPER, minHeight: '100vh' }}>
        <header style={{ padding: '14px 16px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, background: PAPER, zIndex: 5 }}>
          <button onClick={() => setOpenThread(null)} style={btnGhost}>← Back</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500 }}>{partnerName}</div>
            {partnerHandle && <div style={{ fontSize: 12, color: MUTED }}>@{partnerHandle}</div>}
          </div>
        </header>
        <div style={{ padding: '16px', paddingBottom: 200 }}>
          {threadMessages.map(m => {
            const mine = m.sender_id !== partner?.id;
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                <div style={{
                  maxWidth: '78%',
                  background: mine ? INK : '#fff',
                  color: mine ? '#fff' : INK,
                  border: mine ? 'none' : `1px solid ${LINE}`,
                  padding: '10px 14px', borderRadius: 14,
                  fontSize: 14, lineHeight: 1.45,
                }}>
                  <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                    {INTENT_EMOJI[m.intent] || ''} {m.intent}{m.ai_drafted ? ' · 🤖 ai' : ''}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>
                    {new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {lastIncoming && (
          <div style={{ position: 'fixed', bottom: 'calc(72px + env(safe-area-inset-bottom))', left: 0, right: 0, padding: '10px 12px', background: PAPER, borderTop: `1px solid ${LINE}` }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                value={replyText} onChange={e => setReplyText(e.target.value)}
                placeholder={`Reply to ${partnerName}…`} rows={1}
                style={{ flex: 1, resize: 'none', padding: '10px 14px', border: `1px solid ${LINE}`, borderRadius: 18, fontSize: 14, fontFamily: BODY, outline: 'none', background: '#fff' }}
              />
              <button onClick={() => decline(lastIncoming.id)} disabled={sending} style={{ ...btnGhost, color: ERROR, padding: '8px 12px' }}>Decline</button>
              <button onClick={() => sendReply(lastIncoming.id)} disabled={!replyText.trim() || sending} style={{ ...btnPrimary, opacity: replyText.trim() ? 1 : 0.5 }}>
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div style={{ fontFamily: BODY, color: INK }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, letterSpacing: '-0.01em', marginBottom: 4 }}>Partners</h1>
        <p style={{ fontSize: 13, color: MUTED }}>Messages between your bot and other businesses on MiniMe.</p>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: `1px solid ${LINE}` }}>
        {['inbox', 'sent'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '10px 4px', fontSize: 13, fontWeight: 500, fontFamily: BODY,
            color: tab === t ? INK : MUTED, borderBottom: tab === t ? `2px solid ${INK}` : '2px solid transparent',
            marginRight: 12, textTransform: 'capitalize',
          }}>{t}</button>
        ))}
        <button onClick={() => setComposeOpen(v => !v)} style={{ ...btnPrimary, marginLeft: 'auto', marginBottom: 8 }}>
          + New message
        </button>
      </div>

      {composeOpen && <ComposeForm initData={initData} onSent={() => { setComposeOpen(false); load(); }} onCancel={() => setComposeOpen(false)} />}

      {loading ? (
        <div style={{ textAlign: 'center', color: MUTED, padding: 40 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', color: MUTED, padding: 40, fontFamily: SERIF, fontStyle: 'italic' }}>
          {tab === 'inbox' ? 'No partner messages yet.' : 'You haven\'t messaged any partners yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(it => {
            const partner = tab === 'inbox' ? it.sender : it.recipient;
            const s = STATUS_META[it.status] || STATUS_META.pending;
            return (
              <button key={it.id} onClick={() => openConversation(it.thread_id)} style={{
                appearance: 'none', textAlign: 'left', background: '#fff', border: `1px solid ${LINE}`,
                borderRadius: 12, padding: '14px', cursor: 'pointer', fontFamily: BODY,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: INK }}>{partner?.name || 'Unknown'}</span>
                    {partner?.telegram_bot_username && <span style={{ fontSize: 12, color: MUTED, marginLeft: 6 }}>@{partner.telegram_bot_username}</span>}
                  </div>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 999,
                    background: s.bg, color: s.color, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                  }}>{s.label}</span>
                </div>
                <div style={{ fontSize: 13, color: INK, opacity: 0.85, lineHeight: 1.45 }}>
                  <span style={{ marginRight: 6 }}>{INTENT_EMOJI[it.intent] || ''}</span>
                  {it.content.length > 140 ? it.content.slice(0, 140) + '…' : it.content}
                </div>
                <div style={{ fontSize: 11, color: MUTED }}>
                  {new Date(it.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ComposeForm({ initData, onSent, onCancel }) {
  const [target, setTarget] = useState('');
  const [message, setMessage] = useState('');
  const [intent, setIntent]   = useState('inquiry');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');

  const submit = async () => {
    setError('');
    if (!target.trim() || !message.trim()) { setError('Both fields required'); return; }
    setSending(true);
    try {
      const r = await fetch(`/api/b2b`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'send', target_username: target.trim(), intent, message: message.trim() }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error === 'not_on_minime' ? `@${target.replace(/^@/,'')} isn't on MiniMe yet.` : (j.error || 'Failed'));
        setSending(false); return;
      }
      onSent?.();
    } catch (e) { setError(e.message); setSending(false); }
  };

  return (
    <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <span style={{ color: MUTED, fontSize: 14 }}>To</span>
        <input value={target} onChange={e => setTarget(e.target.value)} placeholder="@bot_username" style={inp} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {['inquiry', 'order', 'coordination', 'chat'].map(i => (
          <button key={i} onClick={() => setIntent(i)} style={{
            background: intent === i ? INK : '#fff', color: intent === i ? '#fff' : INK,
            border: `1px solid ${intent === i ? INK : LINE}`, borderRadius: 999,
            padding: '4px 12px', fontSize: 12, fontFamily: BODY, cursor: 'pointer',
            textTransform: 'capitalize',
          }}>{INTENT_EMOJI[i]} {i}</button>
        ))}
      </div>
      <textarea
        value={message} onChange={e => setMessage(e.target.value)}
        placeholder="What do you want to ask or tell them?"
        rows={3}
        style={{ ...inp, width: '100%', resize: 'vertical', minHeight: 70 }}
      />
      {error && <div style={{ color: ERROR, fontSize: 12, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        <button onClick={onCancel} style={btnGhost}>Cancel</button>
        <button onClick={submit} disabled={sending} style={btnPrimary}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

const inp = {
  padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 8,
  fontSize: 14, fontFamily: BODY, outline: 'none', background: '#fff', color: INK,
  flex: 1,
};
const btnPrimary = {
  background: INK, color: '#fff', border: 'none', borderRadius: 999,
  padding: '8px 16px', fontSize: 13, fontWeight: 500, fontFamily: BODY, cursor: 'pointer',
};
const btnGhost = {
  background: 'transparent', color: INK, border: `1px solid ${LINE}`, borderRadius: 999,
  padding: '8px 14px', fontSize: 13, fontFamily: BODY, cursor: 'pointer',
};
