'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../../../hooks/useSupabase';
import ChatDetail from '../../../../components/conversations/ChatDetail';

export default function ConversationDetailPage({ params }) {
  const supabase = useSupabase();
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    async function load() {
      const { data: conv } = await supabase.from('conversations').select('*, customers(*)').eq('id', params.id).single();
      setConversation(conv);
      const { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', params.id).order('created_at', { ascending: true }).limit(100);
      setMessages(msgs || []);
    }
    load();

    // Realtime subscription
    const channel = supabase.channel(`conv:${params.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${params.id}` },
        (payload) => setMessages(prev => [...prev, payload.new])
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [params.id]);

  if (!conversation) return <div className="text-muted">Loading...</div>;

  return <ChatDetail conversation={conversation} messages={messages} />;
}
