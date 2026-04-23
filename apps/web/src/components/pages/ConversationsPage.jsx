'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import ChatList from '../conversations/ChatList';
import PageHeader from '../ui/PageHeader';
import { SkeletonList } from '../ui/Skeleton';

export default function ConversationsPage() {
  const { business } = useTelegram();
  const supabase = createClient();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const businessId = business?.id;

  useEffect(() => {
    if (businessId) fetchConversations(businessId, filter);
  }, [filter, businessId]);

  async function fetchConversations(bizId, f) {
    setLoading(true);
    let q = supabase
      .from('conversations')
      .select('*, customers(*)')
      .eq('business_id', bizId)
      .order('last_message_at', { ascending: false })
      .limit(50);
    if (f === 'pending') q = q.eq('requires_owner', true);
    if (f === 'urgent') q = q.eq('priority', 'urgent');
    if (f === 'ai') q = q.eq('last_ai_action', 'auto_sent');
    const { data } = await q;
    setConversations(data || []);
    setLoading(false);
  }

  const tabs = ['all', 'pending', 'urgent', 'ai'];

  return (
    <div className="max-w-xl mx-auto pb-6">
      <header className="mb-5">
        <h1 className="font-display text-2xl text-gold-light">Chats</h1>
        <p className="text-muted text-sm mt-0.5">Your customer conversations</p>
      </header>

      <div className="flex gap-5 border-b border-border mb-4 overflow-x-auto scrollbar-none">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`pb-2.5 text-sm transition relative whitespace-nowrap ${
              filter === tab ? 'text-gold-light font-medium' : 'text-muted'
            }`}
          >
            {tab === 'ai' ? 'AI handled' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            {filter === tab && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-gold" />}
          </button>
        ))}
      </div>
      {loading ? <SkeletonList rows={5} /> : <ChatList conversations={conversations} />}
    </div>
  );
}
