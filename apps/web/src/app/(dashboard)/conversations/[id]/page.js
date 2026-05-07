'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import ChatDetail from '../../../../components/conversations/ChatDetail';
import { COLORS, FONT } from '../../../../lib/design-tokens';

export default function ConversationDetailPage({ params }) {
  const { initData, loading: tgLoading, error: tgError } = useTelegram() || {};
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [err, setErr] = useState(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!initData) return;
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch(`/api/conversations/${params.id}`, {
          headers: { 'x-telegram-init-data': initData },
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        const j = await r.json();
        if (cancelled) return;
        setConversation(j.conversation);
        setMessages(j.messages || []);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setFetched(true);
      }
    }
    load();
    const iv = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [params.id, initData]);

  const msgStyle = { padding: 16, fontSize: 14, fontFamily: FONT.body };

  if (tgLoading) return <div style={{ ...msgStyle, color: COLORS.textHint }}>Loading Telegram auth…</div>;
  if (tgError)   return <div style={{ ...msgStyle, color: COLORS.red }}>Auth error: {tgError}</div>;
  if (!initData) return <div style={{ ...msgStyle, color: COLORS.textHint }}>Open this page inside Telegram.</div>;
  if (err && !conversation) return (
    <div style={{ padding: 16, fontFamily: FONT.body }}>
      <p style={{ color: COLORS.red, fontSize: 14, margin: '0 0 4px' }}>Couldn't load chat.</p>
      <p style={{ color: COLORS.textHint, fontSize: 12, margin: 0 }}>{err}</p>
    </div>
  );
  if (!fetched) return <div style={{ ...msgStyle, color: COLORS.textHint }}>Loading chat…</div>;
  if (!conversation) return <div style={{ ...msgStyle, color: COLORS.textHint }}>Chat not found.</div>;

  return (
    <>
      <ChatDetail conversation={conversation} messages={messages} />
      {err && <p style={{ color: COLORS.amber, fontSize: 12, marginTop: 8, padding: '0 16px' }}>Refresh warning: {err}</p>}
      <p style={{ color: COLORS.textHint, fontSize: 10, marginTop: 8, padding: '0 16px', fontFamily: FONT.body }}>
        {messages.length} message{messages.length === 1 ? '' : 's'}
        {' · '}
        inbound {messages.filter(m => m.direction === 'inbound').length}
        {' · '}
        outbound {messages.filter(m => m.direction === 'outbound').length}
      </p>
    </>
  );
}
