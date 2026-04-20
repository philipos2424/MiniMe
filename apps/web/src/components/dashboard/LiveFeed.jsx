'use client';
import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { useSupabase } from '../../hooks/useSupabase';
import { timeAgo } from '../../lib/utils';

export default function LiveFeed({ businessId }) {
  const supabase = useSupabase();
  const [events, setEvents] = useState([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('messages')
        .select('*, customers(name)')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(10);
      setEvents(data || []);
    }
    load();

    const channel = supabase
      .channel('live-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `business_id=eq.${businessId}` },
        (payload) => setEvents(prev => [payload.new, ...prev.slice(0, 9)])
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [businessId]);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-gold font-semibold text-sm inline-flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Live Activity
        </h2>
        <span className="text-muted text-[11px]">ቅጽበታዊ እንቅስቃሴ</span>
      </div>
      <div className="space-y-2">
        {events.map(e => (
          <div key={e.id} className="flex items-center gap-3 text-sm">
            <span>{e.direction === 'inbound' ? '📩' : e.is_ai_generated ? '🤖' : '✍️'}</span>
            <span className="text-body flex-1 truncate">
              {e.customers?.name || 'Customer'}: {e.content.slice(0, 50)}
              {e.content.length > 50 ? '...' : ''}
            </span>
            <span className="text-muted text-xs shrink-0">{timeAgo(e.created_at)}</span>
          </div>
        ))}
        {!events.length && (
          <div className="flex flex-col items-center justify-center text-center py-8 gap-2">
            <div className="w-10 h-10 rounded-full bg-bg border border-border flex items-center justify-center">
              <Bot size={18} className="text-muted" />
            </div>
            <p className="text-muted text-sm">ምንም ተግባር የለም / Your agent is idle</p>
            <p className="text-muted text-xs">Activity will stream here as messages arrive.</p>
          </div>
        )}
      </div>
    </div>
  );
}
