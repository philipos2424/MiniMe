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
    <div className="space-y-5">
      <PageHeader
        title="Conversations"
        subtitleAm="መልዕክቶች"
        subtitleEn="Live chats with your customers"
      />
      <div className="flex gap-2 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium capitalize transition ${
              filter === tab
                ? 'bg-gold text-bg'
                : 'bg-card border border-border text-muted hover:text-body hover:border-gold/40'
            }`}
          >
            {tab === 'ai' ? 'AI Handled' : tab}
          </button>
        ))}
      </div>
      {loading ? <SkeletonList rows={5} /> : <ChatList conversations={conversations} />}
    </div>
  );
}
