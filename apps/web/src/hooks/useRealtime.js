'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from './useSupabase';

export function useRealtime(table, filter, onEvent) {
  const supabase = useSupabase();

  useEffect(() => {
    const channel = supabase
      .channel(`realtime:${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, onEvent)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [table, filter]);
}

export function useRealtimeMessages(businessId) {
  const [messages, setMessages] = useState([]);
  const supabase = useSupabase();

  useRealtime('messages', `business_id=eq.${businessId}`, (payload) => {
    if (payload.eventType === 'INSERT') {
      setMessages(prev => [payload.new, ...prev]);
    }
  });

  return messages;
}
