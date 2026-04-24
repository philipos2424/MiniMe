'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import ChatDetail from '../../../../components/conversations/ChatDetail';

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

  if (tgLoading) return <div className="text-muted p-4 text-sm">Loading Telegram auth…</div>;
  if (tgError)   return <div className="text-red-400 p-4 text-sm">Auth error: {tgError}</div>;
  if (!initData) return <div className="text-muted p-4 text-sm">Open this page inside Telegram.</div>;
  if (err && !conversation) return (
    <div className="p-4 text-sm">
      <p className="text-red-400 mb-1">Couldn't load chat.</p>
      <p className="text-muted text-xs">{err}</p>
    </div>
  );
  if (!fetched) return <div className="text-muted p-4 text-sm">Loading chat…</div>;
  if (!conversation) return <div className="text-muted p-4 text-sm">Chat not found.</div>;

  return (
    <>
      <ChatDetail conversation={conversation} messages={messages} />
      {err && <p className="text-amber-400 text-xs mt-2 px-4">Refresh warning: {err}</p>}
      <p className="text-muted text-[10px] mt-2 px-4">
        {messages.length} message{messages.length === 1 ? '' : 's'}
        {' · '}
        inbound {messages.filter(m => m.direction === 'inbound').length}
        {' · '}
        outbound {messages.filter(m => m.direction === 'outbound').length}
      </p>
    </>
  );
}
