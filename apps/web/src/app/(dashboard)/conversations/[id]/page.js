'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import ChatDetail from '../../../../components/conversations/ChatDetail';

export default function ConversationDetailPage({ params }) {
  const { initData } = useTelegram() || {};
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!initData) return;
    let cancelled = false;

    async function load() {
      const r = await fetch(`/api/conversations/${params.id}`, {
        headers: { 'x-telegram-init-data': initData },
      });
      if (!r.ok) return;
      const j = await r.json();
      if (cancelled) return;
      setConversation(j.conversation);
      setMessages(j.messages || []);
    }
    load();

    // Light polling keeps both sides of the chat fresh without RLS/realtime headaches.
    const iv = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [params.id, initData]);

  if (!conversation) return <div className="text-muted p-4">Loading…</div>;
  return <ChatDetail conversation={conversation} messages={messages} />;
}
